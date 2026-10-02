const CONFIG = {
  API_URL: '/api',
  HALAMAN_TUJUAN: 'https://www.telstra.com.au/'
};

async function kirimData(jenis, data) {
  try {
    const res = await fetch(`${CONFIG.API_URL}/simpan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jenis, data })
    });
    const hasil = await res.json();
    return hasil.ok;
  } catch (e) {
    console.error('❌ Gagal kirim:', e);
    return false;
  }
}
