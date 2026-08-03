# zalo-multi-bridge — Multi-Account Zalo API Bridge

HTTP API bridge quản lý nhiều tài khoản Zalo cùng lúc qua `zca-js`.
Một process, tất cả tài khoản. Tin nhắn được lưu vào SQLite và giữ vĩnh viễn.

**Giới hạn hiện tại:**

- Nhận tin realtime khi server đang chạy. Không có polling.
- Backfill lịch sử cũ qua WebSocket là best-effort.
- Group history sync (`/sync/:groupId`) có thể lỗi 404 do upstream `zca-js`.
- API chưa có authentication → chỉ nên bind `127.0.0.1`.

## Yêu cầu

- **Node.js 18+** và npm.
- **Zalo mobile** đã đăng nhập để scan QR.
- macOS được hỗ trợ auto-start; Linux/Windows chạy foreground bình thường.
- Python 3 chỉ cần nếu dùng Python helper.

## Cài lần đầu

```bash
cd /duong-dan/toi/zalo-multi-bridge
./scripts/setup.sh
```

Lệnh này kiểm tra Node, cài dependencies và in các bước tiếp theo.

Nếu `better-sqlite3` build lỗi trên macOS:

```bash
xcode-select --install
./scripts/setup.sh
```

## Đăng nhập tài khoản đầu tiên

```bash
./scripts/login.sh personal
```

QR sẽ hiện trong terminal. Mở Zalo App trên phone → tab Cá nhân → icon QR scan → quét QR trên màn hình.

Script tự refresh QR khi hết hạn. Đăng nhập thành công thì credentials được lưu tự động.

Thêm nhiều tài khoản:

```bash
./scripts/login.sh work
./scripts/login.sh backup
```

## Chạy bridge

```bash
./scripts/start.sh
```

Server khởi động tại `http://127.0.0.1:8786`. Tự động login tất cả account đã có credentials hợp lệ.

Mở dashboard:

```text
http://127.0.0.1:8786/dashboard
```

Dừng server bằng `Ctrl+C`.

## Các thao tác hằng ngày

| Nhu cầu | Lệnh |
|---|---|
| Cài dependencies lần đầu | `./scripts/setup.sh` |
| Login tài khoản | `./scripts/login.sh personal` |
| Chạy bridge | `./scripts/start.sh` |
| Kiểm tra server đang chạy | `./scripts/status.sh` |
| Kéo lịch sử cũ | `./scripts/backfill.sh personal` |
| List credentials đã lưu | `npm run list` |
| Chạy tests | `npm test` |

Ngoài ra có thể dùng npm scripts:

```bash
npm run add -- tentaikhoan     # login QR lần đầu
npm run login -- tentaikhoan   # login lại (credentials hết hạn)
npm run list                    # danh sách credentials
npm run logout -- tentaikhoan  # ngắt kết nối process hiện tại
npm run help                    # CLI help
```

> **Lưu ý:** `logout` chỉ ngắt kết nối của process hiện tại. Lần start server tiếp theo, tài khoản vẫn được auto-login nếu credentials còn hợp lệ. Để xóa hoàn toàn, xóa file `~/.zalo-multi-bridge/accounts/<account>/credentials.json`.

## Cách sử dụng

### Dashboard

Dashboard tại `/dashboard` cho phép:

- Xem danh sách accounts và trạng thái active.
- Xem messages realtime từ tất cả account.
- Xem conversations (friends + groups).
- Xem chi tiết group.
- Kéo lịch sử cũ (WebSocket backfill).
- Gửi tin nhắn.

### Python helper

```bash
python3 zalo_multi.py health
python3 zalo_multi.py accounts
python3 zalo_multi.py messages
python3 zalo_multi.py messages personal
python3 zalo_multi.py conversations personal
python3 zalo_multi.py friends personal
python3 zalo_multi.py groups personal
python3 zalo_multi.py backfill personal 15
python3 zalo_multi.py send personal <thread-id> "xin chào"
```

Mặc định helper kết nối `http://127.0.0.1:8786`. Dùng biến môi trường cho port khác:

```bash
ZALO_MULTI_BASE_URL=http://127.0.0.1:8787 python3 zalo_multi.py health
```

### Curl / HTTP API

```bash
curl -s http://127.0.0.1:8786/health | python3 -m json.tool
curl -s http://127.0.0.1:8786/accounts
curl -s "http://127.0.0.1:8786/accounts/personal/messages?since=2026-01-01&limit=20"
curl -s "http://127.0.0.1:8786/messages?limit=50"
curl -s -X POST "http://127.0.0.1:8786/accounts/personal/backfill?wait=8000"
curl -s -X POST http://127.0.0.1:8786/accounts/personal/send \
  -H "Content-Type: application/json" \
  -d '{"threadId":"abc123","text":"xin chào"}'
```

### API Endpoints

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Health check + list accounts |
| GET | `/accounts` | Danh sách tất cả accounts |
| GET | `/accounts/:id` | Chi tiết 1 account |
| POST | `/accounts/:id/login` | Fire-and-forget QR login |
| POST | `/accounts/:id/logout` | Ngắt kết nối account |
| POST | `/accounts/login-all` | Auto-login tất cả account có creds |
| GET | `/accounts/:id/messages?since=&limit=` | Lịch sử tin nhắn từ SQLite |
| GET | `/messages?since=&limit=` | Messages từ tất cả accounts |
| GET | `/accounts/:id/conversations` | Friends + groups |
| GET | `/accounts/:id/friends` | Danh sách friends |
| GET | `/accounts/:id/groups` | Danh sách groups |
| GET | `/accounts/:id/history/:threadId` | Chat history trực tiếp từ Zalo API |
| POST | `/accounts/:id/backfill?wait=&lastMsgId=` | Kéo lịch sử cũ qua WebSocket |
| POST | `/accounts/:id/send` | Gửi tin nhắn `{threadId, text}` |
| GET | `/accounts/:id/user/:userId` | Thông tin user |
| GET | `/dashboard` | Dashboard HTML |
| GET | `/events` | SSE realtime events |
| GET | `/qr/:accountId/view` | Trang QR HTML (nếu login đang chờ) |
| POST | `/accounts/:id/sync` | **Legacy:** sync 20 group đầu (có thể lỗi upstream) |
| POST | `/accounts/:id/sync/:groupId?count=200` | **Legacy:** sync 1 group (có thể 404) |

> **Về backfill vs sync:** `/backfill` dùng WebSocket để kéo lịch sử cũ và nên được gọi nhiều lần để đi ngược dần về quá khứ. `/sync` và `/sync/:groupId` gọi REST endpoint đã bị Zalo ngừng hỗ trợ và thường trả lỗi. Dùng `/backfill` thay thế cho `/sync`.

## Dữ liệu và cấu hình

Dữ liệu mặc định nằm tại `~/.zalo-multi-bridge/`:

```text
~/.zalo-multi-bridge/
├── accounts/
│   └── <name>/
│       └── credentials.json   # Cookie/IMEI đăng nhập
└── messages.sqlite            # Toàn bộ lịch sử tin nhắn
```

- **Tin nhắn** lưu trong `messages.sqlite`, không giới hạn số lượng.
- Tham số `limit` của API chỉ giới hạn response (tối đa 500 tin), không xóa dữ liệu trong database.
- **Credentials** lưu riêng trong thư mục `accounts/<name>/credentials.json`.

### Biến môi trường

| Biến | Mặc định | Mô tả |
|---|---|---|
| `ZALO_MULTI_HOST` | `127.0.0.1` | IP server bind |
| `ZALO_MULTI_PORT` | `8786` | Cổng server |
| `ZALO_MULTI_DATA_DIR` | `~/.zalo-multi-bridge` | Thư mục dữ liệu |
| `ZALO_MULTI_BASE_URL` | `http://127.0.0.1:8786` | Base URL cho Python helper |

Ví dụ dùng chung cấu hình:

```bash
export ZALO_MULTI_PORT=8787
export ZALO_MULTI_DATA_DIR="$HOME/Library/Application Support/zalo-bridge"
export ZALO_MULTI_BASE_URL="http://127.0.0.1:8787"

./scripts/start.sh &
python3 zalo_multi.py health
```

### Chuyển dữ liệu JSON cũ

Khi start lần đầu, bridge tự động import các file
`~/.zalo-multi-bridge/messages/<account>.json` vào `messages.sqlite`. Mỗi file chỉ
được import một lần trong transaction. File JSON cũ được giữ nguyên làm backup;
sau khi kiểm tra dữ liệu trong SQLite, bạn có thể tự archive chúng.

Nếu JSON bị lỗi, server dừng và báo rõ file lỗi thay vì bỏ qua hoặc import một
phần.

## Auto-start macOS (tùy chọn)

Chỉ cài service sau khi đã login QR và chạy foreground thành công.

```bash
# Cài và chạy service
./scripts/service-macos.sh install

# Kiểm tra trạng thái
./scripts/service-macos.sh status

# Xem logs
./scripts/service-macos.sh logs

# Khởi động lại
./scripts/service-macos.sh restart

# Gỡ service (không xóa data)
./scripts/service-macos.sh uninstall
```

Service được cài vào `~/Library/LaunchAgents/com.zalo.multi-bridge.plist`, tự động
dùng đúng đường dẫn project, Node binary và data directory hiện tại. Chạy với
port khác:

```bash
ZALO_MULTI_PORT=8787 ./scripts/service-macos.sh install
```

Gỡ service không xóa credentials hay messages database.

## Bảo mật

- **API chưa có authentication.** Để mặc định `ZALO_MULTI_HOST=127.0.0.1`.
- **Không** đặt host `0.0.0.0`, forward port, hoặc expose qua tunnel/VPN trừ khi
  bạn tự bổ sung authentication và firewall.
- `credentials.json` chứa **cookie và IMEI đăng nhập Zalo**. File này:
  - Đã được `.gitignore` loại trừ khỏi Git.
  - Được lưu với permission `0600`.
  - **Tuyệt đối không** chia sẻ, upload cloud, hoặc gửi qua chat.
- Thư mục `~/.zalo-multi-bridge/` có permission `0700`.

## Troubleshooting

| Vấn đề | Giải pháp |
|---|---|
| `node: command not found` | Cài Node.js 18+. |
| `better-sqlite3` build lỗi | `xcode-select --install` rồi chạy lại setup. |
| QR không hiện trong terminal | Đảm bảo terminal hỗ trợ UTF-8. Dùng Terminal.app / iTerm2. |
| QR hết hạn không scan kịp | Script tự refresh QR mới trong vài giây. |
| `EADDRINUSE :::8786` | Port đang bận. Đổi: `ZALO_MULTI_PORT=8787 ./scripts/start.sh`. |
| Server chạy nhưng account không active | Chạy `./scripts/status.sh` kiểm tra. Login lại nếu credentials hết hạn. |
| Backfill không trả dữ liệu | Backfill là best-effort. Chạy lại vài lần với wait lớn hơn. |
| `GROUP_HISTORY_UNAVAILABLE` | Endpoint `/sync/:groupId` đã lỗi upstream. Dùng `/backfill` thay thế. |
| Không nhận được tin realtime | Server cần chạy liên tục mới nhận được tin qua WebSocket listener. |
| Muốn xóa credentials hoàn toàn | Tắt server, xóa `~/.zalo-multi-bridge/accounts/<name>/credentials.json`. |
| Muốn xóa toàn bộ data | Tắt server, xóa `~/.zalo-multi-bridge/` (cẩn thận: mất hết credentials và messages). |
