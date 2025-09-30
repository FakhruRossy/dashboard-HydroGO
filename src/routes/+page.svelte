<script>
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { supabase } from '$lib/supabaseClient';
  import { Chart } from 'chart.js/auto';

  // State untuk data real-time
  let latestLog = { ph: '...', tds: '...', ph_auto: '...', created_at: null, ph_v: '...', tds_v: '...' };
  
  let loading = true;
  let error = null;
  let channel;
  let historicalData = [];

  // ## PERUBAHAN DI SINI: Variabel untuk 3 grafik terpisah ##
  let phChartCanvas, tdsChartCanvas, voltageChartCanvas;
  let phChartInstance, tdsChartInstance, voltageChartInstance;

  // State untuk fitur tambahan
  let isExporting = false;
  let exportMessage = '';
  let exportError = '';
  let isClearing = false;
  let clearMessage = '';
  let clearError = '';

  // Logika Tema (tidak berubah)
  const createPersistentTheme = () => {
    if (typeof window === 'undefined') return writable('light');
    const storedTheme = localStorage.getItem('theme');
    const userPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = storedTheme || (userPrefersDark ? 'dark' : 'light');
    const theme = writable(initialTheme);
    theme.subscribe(value => {
      localStorage.setItem('theme', value);
      document.documentElement.classList.toggle('dark', value === 'dark');
    });
    return theme;
  };
  const theme = createPersistentTheme();

  // Opsi umum untuk semua grafik agar konsisten
  const getChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { 
        beginAtZero: false,
        ticks: { color: $theme === 'dark' ? '#cbd5e1' : '#475569' }
      },
      x: {
        ticks: { color: $theme === 'dark' ? '#cbd5e1' : '#475569' }
      }
    },
    plugins: {
      legend: {
        labels: { color: $theme === 'dark' ? '#cbd5e1' : '#475569' }
      }
    }
  });

  // ## FUNGSI GRAFIK DIPISAH ##

  // Fungsi untuk menggambar grafik pH
  function updatePhChart() {
    if (phChartInstance) phChartInstance.destroy();
    if (!phChartCanvas) return;
    const labels = historicalData.map(d => new Date(d.created_at).toLocaleTimeString('id-ID'));
    const phData = historicalData.map(d => d.ph);

    phChartInstance = new Chart(phChartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'pH Air',
          data: phData,
          borderColor: $theme === 'dark' ? 'rgb(96, 165, 250)' : 'rgb(59, 130, 246)',
          backgroundColor: $theme === 'dark' ? 'rgba(96, 165, 250, 0.1)' : 'rgba(59, 130, 246, 0.1)',
          tension: 0.3,
          fill: true,
        }]
      },
      options: getChartOptions()
    });
  }

  // Fungsi untuk menggambar grafik TDS
  function updateTdsChart() {
    if (tdsChartInstance) tdsChartInstance.destroy();
    if (!tdsChartCanvas) return;
    const labels = historicalData.map(d => new Date(d.created_at).toLocaleTimeString('id-ID'));
    const tdsData = historicalData.map(d => d.tds);

    tdsChartInstance = new Chart(tdsChartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'TDS (ppm)',
          data: tdsData,
          borderColor: $theme === 'dark' ? 'rgb(74, 222, 128)' : 'rgb(22, 163, 74)',
          backgroundColor: $theme === 'dark' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(22, 163, 74, 0.1)',
          tension: 0.3,
          fill: true,
        }]
      },
      options: getChartOptions()
    });
  }

  // Fungsi untuk menggambar grafik Tegangan
  function updateVoltageChart() {
    if (voltageChartInstance) voltageChartInstance.destroy();
    if (!voltageChartCanvas) return;
    const labels = historicalData.map(d => new Date(d.created_at).toLocaleTimeString('id-ID'));
    const phVData = historicalData.map(d => d.ph_v);
    const tdsVData = historicalData.map(d => d.tds_v);

    voltageChartInstance = new Chart(voltageChartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'pH Voltage',
            data: phVData,
            borderColor: $theme === 'dark' ? 'rgb(192, 132, 252)' : 'rgb(168, 85, 247)',
            backgroundColor: $theme === 'dark' ? 'rgba(192, 132, 252, 0.1)' : 'rgba(168, 85, 247, 0.1)',
            tension: 0.3,
            fill: true,
          },
          {
            label: 'TDS Voltage',
            data: tdsVData,
            borderColor: $theme === 'dark' ? 'rgb(251, 146, 60)' : 'rgb(249, 115, 22)',
            backgroundColor: $theme === 'dark' ? 'rgba(251, 146, 60, 0.1)' : 'rgba(249, 115, 22, 0.1)',
            tension: 0.3,
            fill: true,
          }
        ]
      },
      options: getChartOptions()
    });
  }

  // Fungsi utama untuk update semua grafik sekaligus
  function updateAllCharts() {
    updatePhChart();
    updateTdsChart();
    updateVoltageChart();
  }

  // Re-render semua chart saat theme berubah
  $: if ($theme && (phChartInstance || tdsChartInstance || voltageChartInstance)) {
    updateAllCharts();
  }

  // Fungsi Ekspor & Hapus (tidak berubah)
  async function exportAllDataToCsv() {
    isExporting = true;
    exportMessage = '';
    exportError = '';
    try {
      const { data: allData, error } = await supabase
        .from('sensor_logs')
        .select('created_at, ph, tds, ph_v, tds_v, ph_auto')
        .order('created_at', { ascending: true });
      if (error) throw error;
      if (allData.length === 0) {
        exportError = 'Tidak ada data untuk diekspor.';
        setTimeout(() => exportError = '', 3000);
        return;
      }
      const headers = ['Waktu', 'pH Air', 'TDS (ppm)', 'pH Voltage', 'TDS Voltage', 'Siklus Pompa pH'];
      const csvRows = [headers.join(',')];
      for (const row of allData) {
        const formattedDate = new Date(row.created_at).toLocaleString('id-ID');
        const values = [ `"${formattedDate}"`, row.ph, row.tds, row.ph_v, row.tds_v, row.ph_auto ];
        csvRows.push(values.join(','));
      }
      const csvString = csvRows.join('\n');
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().slice(0, 10);
        link.setAttribute('href', url);
        link.setAttribute('download', `export_semua_data_hidroponik_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
      exportMessage = `✅ Berhasil ekspor ${allData.length} baris data!`;
      setTimeout(() => exportMessage = '', 4000);
    } catch (err) {
      exportError = `❌ Gagal ekspor: ${err.message}`;
      setTimeout(() => exportError = '', 4000);
    } finally {
      isExporting = false;
    }
  }

  async function handleClearLogs() {
    isClearing = true;
    clearMessage = '';
    clearError = '';
    try {
      const { error } = await supabase.from('sensor_logs').delete().gt('id', -1);
      if (error) throw error;
      historicalData = [];
      latestLog = { ph: '...', tds: '...', ph_auto: '...', created_at: null, ph_v: '...', tds_v: '...' };
      updateAllCharts();
      clearMessage = '✅ Semua log sensor berhasil dihapus!';
      setTimeout(() => clearMessage = '', 3000);
    } catch (err) {
      clearError = '❌ Gagal menghapus log: ' + err.message;
      setTimeout(() => clearError = '', 3000);
    } finally {
      isClearing = false;
    }
  }

  onMount(async () => {
    try {
      const { data: latest, error: latestError } = await supabase.from('sensor_logs').select('ph, tds, ph_auto, created_at, ph_v, tds_v').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (latestError && latestError.code !== 'PGRST116') throw latestError;
      if (latest) latestLog = latest;

      const { data: history, error: historyError } = await supabase.from('sensor_logs').select('ph, tds, created_at, ph_v, tds_v').order('created_at', { ascending: false }).limit(30);
      if (historyError) throw historyError;
      if (history) historicalData = history.reverse();

    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }

    updateAllCharts();

    channel = supabase.channel('sensor_logs_realtime_v3')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sensor_logs' },
        (payload) => {
          console.log('Data baru masuk!', payload.new);
          latestLog = payload.new;
          historicalData = [...historicalData, payload.new];
          if (historicalData.length > 30) {
            historicalData.shift();
          }
          error = null;
          updateAllCharts();
        }
      )
      .subscribe();
  });

  onDestroy(() => {
    if (channel) supabase.removeChannel(channel);
    if (phChartInstance) phChartInstance.destroy();
    if (tdsChartInstance) tdsChartInstance.destroy();
    if (voltageChartInstance) voltageChartInstance.destroy();
  });
</script>

<div>
  <div class="bg-slate-100 dark:bg-slate-900 min-h-screen font-sans text-slate-800 dark:text-slate-200 transition-colors duration-300">
    
    <header class="max-w-7xl mx-auto p-4 md:p-8 flex justify-between items-center">
      <div>
        <h1 class="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">💧 Dashboard HydroGO</h1>
        <p class="text-slate-500 dark:text-slate-400 mt-1">
          {#if loading} Mencari data...
          {:else if latestLog.created_at} Data terakhir: {new Date(latestLog.created_at).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'medium' })}
          {:else} Menunggu data baru... {/if}
        </p>
      </div>
    </header>

    <main class="max-w-7xl mx-auto p-4 md:px-8 pb-8">
      {#if error}
        <div class="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-md mb-6" role="alert">
            <p class="font-bold">Terjadi Kesalahan</p>
            <p>{error}</p>
        </div>
      {:else}
        <!-- Bagian Kartu Data -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div class="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-lg flex flex-col items-center transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-2xl hover:shadow-blue-500/50 dark:hover:shadow-blue-400/40 cursor-pointer">
            <h2 class="text-lg font-semibold text-slate-500 dark:text-slate-400">pH Air</h2>
            <p class="text-5xl font-bold my-4 text-blue-600 dark:text-blue-400">
              {typeof latestLog.ph === 'number' ? latestLog.ph.toFixed(2) : latestLog.ph}
            </p>
          </div>
          <div class="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-lg flex flex-col items-center transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-2xl hover:shadow-green-500/50 dark:hover:shadow-green-400/40 cursor-pointer">
            <h2 class="text-lg font-semibold text-slate-500 dark:text-slate-400">TDS (ppm)</h2>
            <p class="text-5xl font-bold my-4 text-green-600 dark:text-green-400">{latestLog.tds}</p>
          </div>
          <div class="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-lg flex flex-col items-center transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-2xl hover:shadow-amber-500/50 dark:hover:shadow-amber-400/40 cursor-pointer">
            <h2 class="text-lg font-semibold text-slate-500 dark:text-slate-400">Siklus Pompa pH</h2>
            <p class="text-5xl font-bold my-4 text-amber-600 dark:text-amber-400">{latestLog.ph_auto}</p>
            <span class="text-sm text-slate-400">kali</span>
          </div>
        </div>

        <!-- ## BAGIAN GRAFIK YANG BARU ## -->
        <div class="space-y-6">
          <!-- Tombol Export diletakkan di sini -->
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-lg">
              <h2 class="text-2xl font-bold text-slate-900 dark:text-white">Analisis Grafik Sensor</h2>
              <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                  <button on:click={exportAllDataToCsv} disabled={isExporting}
                          class="inline-flex items-center justify-center py-2 px-3 border border-slate-300 dark:border-slate-600 shadow-sm text-sm font-medium rounded-md text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all disabled:opacity-50">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    {isExporting ? 'Mengekspor...' : 'Export Semua Data'}
                  </button>
                  <div class="text-xs text-center sm:text-left h-4">
                    {#if exportMessage}<p class="text-green-600 dark:text-green-400">{exportMessage}</p>{/if}
                    {#if exportError}<p class="text-red-600 dark:text-red-400">{exportError}</p>{/if}
                  </div>
              </div>
          </div>

          <!-- Grid untuk 2 grafik atas -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <!-- Grafik pH -->
              <div class="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-xl shadow-lg">
                <h2 class="text-xl font-bold mb-4 text-slate-900 dark:text-white">Grafik pH</h2>
                <div class="h-80 relative">
                    <canvas bind:this={phChartCanvas}></canvas>
                </div>
              </div>

              <!-- Grafik TDS -->
              <div class="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-xl shadow-lg">
                <h2 class="text-xl font-bold mb-4 text-slate-900 dark:text-white">Grafik TDS</h2>
                <div class="h-80 relative">
                    <canvas bind:this={tdsChartCanvas}></canvas>
                </div>
              </div>
          </div>

          <!-- Grafik Tegangan -->
          <div class="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-xl shadow-lg">
            <h2 class="text-xl font-bold mb-4 text-slate-900 dark:text-white">Grafik Tegangan Sensor</h2>
            <div class="h-80 relative">
                <canvas bind:this={voltageChartCanvas}></canvas>
            </div>
          </div>
        </div>

        <!-- Zona Berbahaya -->
        <div class="mt-6 bg-red-50 dark:bg-slate-800/50 border border-red-200 dark:border-red-900/50 p-6 rounded-xl shadow-lg">
            <h2 class="text-xl font-bold mb-2 text-red-800 dark:text-red-300">Clear Data</h2>
            <p class="text-slate-600 dark:text-slate-400 mb-4 text-sm">Tindakan berikut bersifat permanen dan tidak dapat diurungkan. Lanjutkan dengan hati-hati.</p>
            <div class="flex items-center gap-4">
                <button on:click={handleClearLogs} disabled={isClearing}
                        class="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:bg-red-400 dark:disabled:bg-red-500 transition-all">
                    {isClearing ? 'Menghapus...' : 'Hapus Semua Log Sensor'}
                </button>
                {#if clearMessage}<p class="text-sm text-green-600 dark:text-green-400">{clearMessage}</p>{/if}
                {#if clearError}<p class="text-sm text-red-600 dark:text-red-400">{clearError}</p>{/if}
            </div>
        </div>
      {/if}
    </main>
  </div>
</div>

