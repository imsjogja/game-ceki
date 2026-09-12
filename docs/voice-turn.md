# TURN untuk voice chat produksi

Signaling voice RemiKu memakai WebSocket `wss://<domain>/api/voice`; Caddy
akan meneruskan upgrade WebSocket seperti reverse proxy HTTP biasa. Audio
WebRTC tetap mengalir peer-to-peer. STUN saja tidak cukup untuk pengguna di
jaringan NAT simetris, firewall kantor, atau sebagian mobile carrier, sehingga
produksi perlu TURN relay.

## Konfigurasi aplikasi

Simpan nilai ini hanya pada `.env` produksi, jangan commit:

```env
VOICE_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
VOICE_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
VOICE_TURN_SECRET=<secret-yang-sama-dengan-coturn>
VOICE_TURN_TTL_SECONDS=600
```

Aplikasi membuat credential TURN REST berumur pendek dari secret tersebut dan
hanya memberikannya kepada pemain manusia yang terautentikasi di room terkait.

## coturn

Pasang coturn pada host publik atau server TURN khusus. Konfigurasi minimal
harus memakai shared secret, misalnya:

```conf
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=<secret-yang-sama-dengan-VOICE_TURN_SECRET>
realm=turn.example.com
min-port=49160
max-port=49200
no-multicast-peers
no-cli
```

Buka port berikut pada UFW **dan** Oracle Cloud Security List/NSG:

- UDP dan TCP `3478` untuk negosiasi TURN.
- UDP `49160-49200` untuk media relay.

Caddy tidak dapat meneruskan range UDP relay tersebut. Setelah konfigurasi,
uji dua akun pada jaringan berbeda (misalnya Wi-Fi dan hotspot). Pada browser
yang memerlukan relay, `RTCPeerConnection.getStats()` harus menunjukkan
candidate pair bertipe `relay`.
