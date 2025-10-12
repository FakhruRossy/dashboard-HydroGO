<script>
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { supabase } from '$lib/supabaseClient';
  import { Chart } from 'chart.js/auto';

  // State untuk data real-time
  let latestLog = { ph: '...', tds: '...', ph_auto: '...', created_at: null, ph_v: '...', tds_v: '...' };
  
  // State untuk data konfigurasi diperbarui
  let config = {
    // Target
    ph_target_min: null,
    ph_target_max: null,
    tds_target_min: null,
    // Kalibrasi
    ph_offset: null,
    tds_offset: null,
    ph_cal_m_value: null,
    ph_cal_c_value: null,
    // Otomasi
    is_automation_active: false,
    automation_start_delay_ms: null,
    pump_ph_on_duration_ms: null,
    pump_ph_cooldown_duration_ms: null,
    fertilizer_mix_duration_ms: null,
    fertilizer_push_duration_ms: null,
    fertilizer_cooldown_duration_ms: null,
    // Sistem
    supabase_send_interval_ms: null,
    config_fetch_interval_ms: null,
  };

  let loading = true;
  let error = null;
  let channel;
  let historicalData = [];

  // Variabel untuk 3 grafik terpisah
  let phChartCanvas, tdsChartCanvas, voltageChartCanvas;
  let phChartInstance, tdsChartInstance, voltageChartInstance;

  // State untuk fitur tambahan
  let isExporting = false;
  let exportMessage = '';
  let exportError = '';
  let isClearing = false;
  let clearMessage = '';
  let clearError = '';
  
  // State untuk form konfigurasi
  let isSavingConfig = false;
  let configSaveMessage = '';
  let configSaveError = '';


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

  // Fungsi-fungsi grafik (tidak berubah)
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
  
  function updateAllCharts() {
    updatePhChart();
    updateTdsChart();
    updateVoltageChart();
  }

  $: if ($theme && (phChartInstance || tdsChartInstance || voltageChartInstance)) {
    updateAllCharts();
  }

  // Fungsi Update Konfigurasi
  async function handleConfigUpdate() {
    isSavingConfig = true;
    configSaveMessage = '';
    configSaveError = '';
    try {
      const configToUpdate = { ...config };
      delete configToUpdate.id; 

      const { error } = await supabase
        .from('config')
        .update(configToUpdate)
        .eq('id', 1); 

      if (error) throw error;
      configSaveMessage = '✅ Konfigurasi berhasil disimpan!';
      setTimeout(() => configSaveMessage = '', 3000);
    } catch (err) {
      configSaveError = '❌ Gagal menyimpan: ' + err.message;
      setTimeout(() => configSaveError = '', 3000);
    } finally {
      isSavingConfig = false;
    }
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
      // Ambil data sensor
      const { data: latest, error: latestError } = await supabase.from('sensor_logs').select('ph, tds, ph_auto, created_at, ph_v, tds_v').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (latestError && latestError.code !== 'PGRST116') throw latestError;
      if (latest) latestLog = latest;

      const { data: history, error: historyError } = await supabase.from('sensor_logs').select('ph, tds, created_at, ph_v, tds_v').order('created_at', { ascending: false }).limit(30);
      if (historyError) throw historyError;
      if (history) historicalData = history.reverse();

      // Ambil data konfigurasi
      const { data: configData, error: configError } = await supabase.from('config').select('*').eq('id', 1).maybeSingle();
      if (configError) throw configError;
      if (configData) {
        config = { ...config, ...configData };
      }

    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }

    updateAllCharts();

    // Listener real-time
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

        <!-- Bagian Grafik -->
        <div class="space-y-6">
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

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div class="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-xl shadow-lg">
                <h2 class="text-xl font-bold mb-4 text-slate-900 dark:text-white">Grafik pH</h2>
                <div class="h-80 relative">
                    <canvas bind:this={phChartCanvas}></canvas>
                </div>
              </div>
              <div class="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-xl shadow-lg">
                <h2 class="text-xl font-bold mb-4 text-slate-900 dark:text-white">Grafik TDS</h2>
                <div class="h-80 relative">
                    <canvas bind:this={tdsChartCanvas}></canvas>
                </div>
              </div>
          </div>

          <div class="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-xl shadow-lg">
            <h2 class="text-xl font-bold mb-4 text-slate-900 dark:text-white">Grafik Tegangan Sensor</h2>
            <div class="h-80 relative">
                <canvas bind:this={voltageChartCanvas}></canvas>
            </div>
          </div>
        </div>

        <!-- ## FORM KONFIGURASI DENGAN TOOLTIP ## -->
        <div class="mt-6 bg-white dark:bg-slate-800 p-6 rounded-xl shadow-lg">
          <h2 class="text-2xl font-bold mb-6 text-slate-900 dark:text-white">⚙️ Panel Kontrol & Konfigurasi Sistem</h2>
          <form on:submit|preventDefault={handleConfigUpdate}>
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              <!-- Kolom 1: Target & Kalibrasi -->
              <div class="space-y-6">
                <h3 class="text-lg font-semibold text-indigo-600 dark:text-indigo-400 border-b pb-2 border-slate-200 dark:border-slate-700">Pengaturan Target</h3>
                <div class="flex items-center gap-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="ph_min" class="block text-sm font-medium text-slate-700 dark:text-slate-300">pH Minimum</label>
                          <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Batas bawah target pH. Jika pH terukur lebih rendah dari ini, pompa pH Up akan menyala.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="0.1" id="ph_min" bind:value={config.ph_target_min} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="ph_max" class="block text-sm font-medium text-slate-700 dark:text-slate-300">pH Maksimum</label>
                           <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Batas atas target pH. Jika pH terukur lebih tinggi dari ini, pompa pH Down akan menyala.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="0.1" id="ph_max" bind:value={config.ph_target_max} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                </div>
                <div>
                  <div class="flex items-center gap-1.5">
                    <label for="tds_min" class="block text-sm font-medium text-slate-700 dark:text-slate-300">TDS Minimum (ppm)</label>
                     <div class="relative group flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                        Batas bawah target TDS/nutrisi. Jika TDS terukur lebih rendah dari ini, pompa pupuk A & B akan aktif.
                      </span>
                    </div>
                  </div>
                  <input type="number" step="1" id="tds_min" bind:value={config.tds_target_min} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                </div>
                
                <h3 class="text-lg font-semibold text-indigo-600 dark:text-indigo-400 border-b pb-2 border-slate-200 dark:border-slate-700 pt-4">Pengaturan Kalibrasi</h3>
                 <div class="flex items-center gap-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="ph_offset" class="block text-sm font-medium text-slate-700 dark:text-slate-300">pH Offset</label>
                           <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Nilai koreksi manual untuk pH. Nilai ini akan ditambahkan ke hasil pembacaan sensor. Isi dengan 0 jika tidak ada koreksi.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="0.01" id="ph_offset" bind:value={config.ph_offset} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="tds_offset" class="block text-sm font-medium text-slate-700 dark:text-slate-300">TDS Offset</label>
                           <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Nilai koreksi manual untuk TDS. Nilai ini akan ditambahkan ke hasil pembacaan sensor. Isi dengan 0 jika tidak ada koreksi.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="1" id="tds_offset" bind:value={config.tds_offset} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="ph_cal_m" class="block text-sm font-medium text-slate-700 dark:text-slate-300">pH Slope (m)</label>
                           <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Nilai slope (m) untuk konversi tegangan pH. Diambil dari hasil kalibrasi. Hindari mengubah jika tidak yakin.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="any" id="ph_cal_m" bind:value={config.ph_cal_m_value} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="ph_cal_c" class="block text-sm font-medium text-slate-700 dark:text-slate-300">pH Intercept (c)</label>
                           <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Nilai intercept (c) untuk konversi tegangan pH. Diambil dari hasil kalibrasi. Hindari mengubah jika tidak yakin.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="any" id="ph_cal_c" bind:value={config.ph_cal_c_value} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                </div>
              </div>

              <!-- Kolom 2: Otomasi -->
              <div class="space-y-6">
                <h3 class="text-lg font-semibold text-indigo-600 dark:text-indigo-400 border-b pb-2 border-slate-200 dark:border-slate-700">Pengaturan Otomasi</h3>
                <div class="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg">
                  <div class="flex items-center gap-1.5">
                    <label for="is_automation_active" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Status Automasi</label>
                     <div class="relative group flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                        Saklar utama automasi. Jika true, automasi pH dan nutrisi akan berjalan. Jika false, semua automasi mati.
                      </span>
                    </div>
                  </div>
                  <button type="button" on:click={() => config.is_automation_active = !config.is_automation_active} class:bg-indigo-600={config.is_automation_active} class:bg-slate-300={!config.is_automation_active} class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                    <span class:translate-x-5={config.is_automation_active} class:translate-x-0={!config.is_automation_active} class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"></span>
                  </button>
                </div>
                 <div>
                  <div class="flex items-center gap-1.5">
                    <label for="automation_start_delay_ms" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Jeda Awal Automasi (ms)</label>
                     <div class="relative group flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                        Jeda waktu setelah alat menyala sebelum automasi mulai berjalan. Berguna agar sensor stabil dulu. (Contoh: 180000 = 3 menit)
                      </span>
                    </div>
                  </div>
                  <input type="number" step="1000" id="automation_start_delay_ms" bind:value={config.automation_start_delay_ms} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                </div>
                <div class="flex items-center gap-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="pump_ph_on_duration_ms" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Durasi Pompa pH (ms)</label>
                           <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Durasi pompa pH (Up/Down) menyala dalam satu siklus dosing.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="100" id="pump_ph_on_duration_ms" bind:value={config.pump_ph_on_duration_ms} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="pump_ph_cooldown_duration_ms" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Jeda Pompa pH (ms)</label>
                           <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Waktu jeda minimal sebelum pompa pH boleh menyala lagi untuk mencegah overdosis.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="1000" id="pump_ph_cooldown_duration_ms" bind:value={config.pump_ph_cooldown_duration_ms} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="fertilizer_mix_duration_ms" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Durasi Mix Nutrisi (ms)</label>
                           <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Durasi pompa pupuk A dan B menyala bersamaan untuk mencampur nutrisi.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="100" id="fertilizer_mix_duration_ms" bind:value={config.fertilizer_mix_duration_ms} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center gap-1.5">
                          <label for="fertilizer_push_duration_ms" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Dorong Nutrisi (ms)</label>
                           <div class="relative group flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                              Durasi pompa pendorong menyala untuk memasukkan campuran nutrisi ke sistem.
                            </span>
                          </div>
                        </div>
                        <input type="number" step="100" id="fertilizer_push_duration_ms" bind:value={config.fertilizer_push_duration_ms} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                    </div>
                </div>
                <div>
                  <div class="flex items-center gap-1.5">
                    <label for="fertilizer_cooldown_duration_ms" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Jeda Pompa Nutrisi (ms)</label>
                     <div class="relative group flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                        Waktu jeda minimal sebelum pompa nutrisi boleh menyala lagi.
                      </span>
                    </div>
                  </div>
                  <input type="number" step="1000" id="fertilizer_cooldown_duration_ms" bind:value={config.fertilizer_cooldown_duration_ms} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                </div>
              </div>

              <!-- Kolom 3: Sistem -->
              <div class="space-y-6">
                <h3 class="text-lg font-semibold text-indigo-600 dark:text-indigo-400 border-b pb-2 border-slate-200 dark:border-slate-700">Pengaturan Sistem</h3>
                <div>
                  <div class="flex items-center gap-1.5">
                    <label for="supabase_send_interval_ms" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Interval Kirim Data (ms)</label>
                     <div class="relative group flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                        Seberapa sering alat mengirim data sensor ke database.
                      </span>
                    </div>
                  </div>
                  <input type="number" step="1000" id="supabase_send_interval_ms" bind:value={config.supabase_send_interval_ms} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                </div>
                <div>
                  <div class="flex items-center gap-1.5">
                    <label for="config_fetch_interval_ms" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Interval Cek Konfigurasi (ms)</label>
                     <div class="relative group flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                        Seberapa sering alat mengecek pembaruan konfigurasi dari database.
                      </span>
                    </div>
                  </div>
                  <input type="number" step="1000" id="config_fetch_interval_ms" bind:value={config.config_fetch_interval_ms} class="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                </div>
              </div>

            </div>

            <!-- Tombol & Pesan -->
            <div class="lg:col-span-3 flex items-center gap-4 pt-6 mt-6 border-t border-slate-200 dark:border-slate-700">
                <button type="submit" disabled={isSavingConfig}
                        class="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-slate-400 dark:disabled:bg-slate-600 transition-all">
                    {isSavingConfig ? 'Menyimpan...' : 'Simpan Semua Konfigurasi'}
                </button>
                {#if configSaveMessage}<p class="text-sm text-green-600 dark:text-green-400">{configSaveMessage}</p>{/if}
                {#if configSaveError}<p class="text-sm text-red-600 dark:text-red-400">{configSaveError}</p>{/if}
            </div>
          </form>
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

