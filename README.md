# Murphy Temp Voice

Bot TempVoice Discord bergaya **TempVoice** (interface 15 tombol + `/voice` commands) dengan dukungan khusus **Bot AFK / Music penjaga room** tanpa batas waktu meski dijalankan di hosting yang terpisah.

## Fitur Utama
- **Interface 15 Tombol (3×5):** `Name`, `Limit`, `Privacy` (Lock/Unlock/Invisible/Visible), `Waiting Room`, `Chat`, `Trust`, `Untrust`, `Invite`, `Kick`, `Region`, `Block`, `Unblock`, `Claim`, `Transfer`, `Delete`.
- **Auto-Upload Application Emojis:** Ke-15 ikon `.webp` di folder `assets/` otomatis di-upload ke Application Emojis bot saat pertama kali bot online (tidak perlu upload manual ke tiap server).
- **AFK / Music Bot Keep-Alive:** Selama ada bot yang masuk whitelist (`STAY_BOT_IDS` atau `/afk-bots add`) di dalam room, voice channel **tidak akan terhapus** meski semua member manusia keluar.
- **Grace Period Anti-Reconnect:** Jeda 15 detik (bisa diatur di `.env`) sebelum menghapus channel kosong, agar channel tidak langsung hilang jika bot musik mengalami *reconnect* singkat.
- **Sinkronisasi Izin Saat Room Locked/Hidden:** Bot AFK whitelist otomatis tetap punya izin `ViewChannel` + `Connect` + `Speak` walau room di-Lock atau Invisible.
- **Claim Ownership:** Jika owner asli keluar dan ada member manusia lain masuk (walau dijaga bot AFK), member tersebut bisa klik `Claim`.

---

## Cara Setup & Menjalankan

### 1. Persiapan di Discord Developer Portal
1. Buat Application & Bot baru (beri nama **Murphy Temp Voice**).
2. Di menu **Bot → Privileged Gateway Intents**, aktifkan:
   - **SERVER MEMBERS INTENT** (untuk fetch member & permission whitelist)
3. Invite bot ke server dengan permission **Administrator** (atau minimal `Manage Channels`, `Move Members`, `View Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Create Instant Invite`).

### 2. Konfigurasi `.env`
Salin `.env.example` menjadi `.env`, lalu isi:
```env
DISCORD_TOKEN=token_bot_kamu
STAY_BOT_IDS=ID_BOT_MUSIK_MURPHY
EMPTY_GRACE_SECONDS=15
CREATE_COOLDOWN_SECONDS=3
AUTO_SYNC_APP_EMOJIS=true
```

### 3. Install & Jalankan
```bash
npm install
npm start
```

### 4. Setup di Server Discord
Jalankan slash command di server:
- `/setup` — Membuat kategori `Murphy Temp Voice`, channel `#interface` (beserta panel 15 tombol), dan voice channel `➕ Join to Create`.
- `/afk-bots add bot:@MurphyMusic` — (Opsional jika belum diisi di `.env`) Menambahkan bot musik/AFK ke whitelist server.
- `/afk-bots list` — Mengecek daftar bot penjaga yang aktif.

