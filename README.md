# zalo-multi-bridge — Multi-Account Zalo API Bridge

HTTP API bridge quản lý nhiều tài khoản Zalo cùng lúc qua `zca-js`.
Một process, tất cả tài khoản.

## Cài đặt

```bash
cd /Users/cuongbich/Documents/zalo-multi-bridge
npm install
```

## Quick Start

### 1. Thêm tài khoản và login QR

```bash
node cli.js add my_account_1
# QR sẽ hiện ra → scan bằng Zalo app trên phone
# Ctrl+C để thoát sau khi login xong
```

### 2. Start API server (với auto-login tất cả tài khoản có credentials)

```bash
npm start
# hoặc: node server.js
```

Server chạy tại `http://127.0.0.1:8786`

### 3. Đọc tin nhắn từ Hermes

```bash
# Dùng Python helper
python3 zalo_multi.py health       # Kiểm tra server
python3 zalo_multi.py accounts     # List tất cả accounts
python3 zalo_multi.py messages     # Đọc messages từ TẤT CẢ accounts
python3 zalo_multi.py messages my_account_1  # Đọc của 1 account
```

## API Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/health` | Health check + list accounts |
| GET | `/accounts` | List tất cả accounts |
| GET | `/accounts/:id` | Chi tiết 1 account |
| POST | `/accounts/:id/login` | Login (QR nếu chưa có creds) |
| POST | `/accounts/:id/logout` | Logout |
| POST | `/accounts/login-all` | Auto-login tất cả accounts có creds |
| GET | `/accounts/:id/messages` | Lịch sử tin nhắn từ SQLite |
| GET | `/messages` | Messages từ TẤT CẢ accounts |
| GET | `/accounts/:id/conversations` | List conversations |
| GET | `/accounts/:id/history/:threadId` | Chat history |
| POST | `/accounts/:id/sync/:groupId?count=200` | Đồng bộ N tin mới nhất của 1 group vào store |
| GET | `/accounts/:id/friends` | List friends |
| GET | `/accounts/:id/groups` | List groups |
| POST | `/accounts/:id/send` | Send message |

## CLI

```bash
node cli.js add <name>     # Add + login QR
node cli.js login <name>   # Re-login
node cli.js list           # List all accounts
node cli.js logout <name>  # Logout
node cli.js start          # Start API server
```

## Data

Dữ liệu mặc định nằm tại `~/.zalo-multi-bridge/`:

```text
~/.zalo-multi-bridge/
├── accounts/<name>/credentials.json  # Cookie/IMEI đăng nhập
└── messages.sqlite                   # Toàn bộ lịch sử tin nhắn
```

Tin nhắn được ghi ngay vào SQLite và **không giới hạn số lượng lưu trữ**. Tham số
`limit` của API chỉ giới hạn số record trong mỗi response (tối đa 500), không xóa
các tin cũ trong database.

Có thể đổi thư mục dữ liệu bằng biến môi trường:

```bash
ZALO_MULTI_DATA_DIR=/duong/dan/moi npm start
```

### Chuyển dữ liệu JSON cũ

Khi start lần đầu, bridge tự động import các file
`~/.zalo-multi-bridge/messages/<account>.json` vào `messages.sqlite`. Mỗi file chỉ
được import một lần trong transaction. File JSON cũ được giữ nguyên làm backup;
sau khi kiểm tra dữ liệu trong SQLite, bạn có thể tự archive chúng.

Nếu JSON bị lỗi, server dừng và báo rõ file lỗi thay vì bỏ qua hoặc import một
phần. Credentials vẫn lưu riêng trong `accounts/<name>/credentials.json`, không
được chuyển vào SQLite.

Chạy test persistence/migration bằng:

```bash
npm test
```

## Hermes Integration

Hermes có thể gọi Python helper trực tiếp từ terminal:

```bash
python3 /Users/cuongbich/Documents/zalo-multi-bridge/zalo_multi.py messages
```

Hoặc dùng `curl`:

```bash
curl -s http://127.0.0.1:8786/messages | python3 -m json.tool
```

## Auto-start (macOS launchd)

```bash
cp com.zalo.multi-bridge.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.zalo.multi-bridge.plist
```
