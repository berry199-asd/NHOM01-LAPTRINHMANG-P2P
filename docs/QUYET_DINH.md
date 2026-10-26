# QUYẾT ĐỊNH THIẾT KẾ & BÁO CÁO ĐIỀU TRA

## 1. Kết Quả Điều Tra Hệ Thống Hiện Tại (BƯỚC 1)

### a) Bảng cơ sở dữ liệu và Endpoint phòng/thành viên
- **Bảng `rooms`**:
  - File: [`backend/src/main/java/com/workchat/tracker/sql/schema.sql#L147-L170`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/sql/schema.sql#L147-L170)
  - Các cột: `id`, `is_direct`, `name`, `avatar_url`, `background_url`, `theme_color`, `default_reaction_emoji`, `member_a_id`, `member_b_id`, `max_members`, `created_by`, `created_at`.
- **Bảng `room_members`**:
  - File: [`backend/src/main/java/com/workchat/tracker/sql/schema.sql#L174-L193`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/sql/schema.sql#L174-L193)
  - Cột vai trò hiện tại: `room_role ENUM('member','leader') NOT NULL DEFAULT 'member'`.
  - Các cột khác: `nickname`, `is_pinned`, `pinned_at`, `is_muted`, `last_read_message_id`, `joined_at`, `left_at`, `banned_at`.
- **Bảng `room_invites`**:
  - File: [`backend/src/main/java/com/workchat/tracker/sql/schema.sql#L195-L200`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/sql/schema.sql#L195-L200)
  - Lưu mã mời `invite_code`, `created_by`, `expires_at`.
- **Endpoint hiện có**:
  - Tạo phòng: `POST /api/rooms` ([`HttpRestHandler.java#L258`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L258), [`HttpRestHandler.java#L1620-L1651`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1620-L1651))
  - Thêm thành viên: `POST /api/rooms/{id}/member/add` ([`HttpRestHandler.java#L1653-L1709`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1653-L1709))
  - Đổi vai trò: `POST /api/rooms/{id}/member/role` ([`HttpRestHandler.java#L1737-L1778`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1737-L1778))
  - Xóa thành viên: `POST /api/rooms/{id}/member/remove` ([`HttpRestHandler.java#L1780-L1803`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1780-L1803))
  - Rời phòng: `POST /api/rooms/{id}/leave` ([`HttpRestHandler.java#L1805-L1813`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1805-L1813))
  - Cập nhật thông tin phòng (tên, avatar, theme, emoji, bg): `PATCH/POST /api/rooms/{id}` ([`HttpRestHandler.java#L1710-L1735`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1710-L1735))
  - Tham gia phòng qua mã: `POST /api/rooms/join` và lấy/tạo mã: `POST /api/rooms/invite` ([`HttpRestHandler.java#L260-L261`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L260-L261))
- **Giao diện hiện có**:
  - `ChatInfoPanel.tsx` ([`src/features/info/ChatInfoPanel.tsx#L33-L1050`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/src/features/info/ChatInfoPanel.tsx#L33-L1050)): Có danh sách thành viên cơ bản, công tắc duyệt thành viên (`conv.approval`), đổi tên, đổi ảnh, gỡ trưởng nhóm, xóa thành viên.
- **Hiện trạng kiểm tra quyền**:
  - `handleRoomMemberRole` ([`HttpRestHandler.java#L1758-L1763`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1758-L1763)) kiểm tra `isLeader`.
  - `handleRoomMemberRemove`, `handleRoomUpdate`, `handleRoomMemberAdd` chỉ kiểm tra `isMember(roomId, me.id())` ([`HttpRestHandler.java#L1661`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1661), [`L1721`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1721), [`L1785`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/http/HttpRestHandler.java#L1785)). Bất kỳ thành viên nào cũng có thể gọi xóa người khác hoặc sửa tên nhóm.
  - **Kết luận**: Quyền quản trị trước đây chủ yếu nằm ở UI, server chưa cưỡng chế phân quyền đầy đủ. Cần bổ sung kiểm tra ma trận quyền nghiêm ngặt ở server (403 + error code).

---

### b) Tính năng tồn tại thật vs tính năng chưa có để gắn quyền
- **Đã tồn tại thật**:
  1. `allow_member_edit_info`: Cập nhật tên phòng, ảnh đại diện phòng (`PATCH /api/rooms/{id}`).
  2. `allow_member_send`: Gửi tin nhắn vào phòng (`POST /api/rooms/{id}/messages` và `POST /api/offline/store`).
  3. `require_join_approval`: Quy trình duyệt thành viên khi được mời hoặc xin vào nhóm.
  4. `join_link_enabled` + `join_token`: Tham gia nhóm qua link / invite code (`/api/rooms/invite`, `/api/rooms/join`).
  5. `highlight_admin_messages`: Đánh dấu tin nhắn từ trưởng/phó nhóm trong luồng tin.
  6. `new_member_read_recent`: Cho phép thành viên mới xem lịch sử tin nhắn gần nhất khi vừa vào nhóm.
  7. Tin hệ thống trong phòng: Thông báo sự kiện đổi vai trò, xóa/rời/thêm thành viên.
- **CHƯA CÓ tính năng thật trong codebase (Lưu cờ DB, UI hiển thị nhãn "Sắp có" hoặc ẩn công tắc; KHÔNG tự xây tính năng ngoài phạm vi)**:
  1. `allow_member_pin`: Ghim tin nhắn, ghi chú, bình chọn (Codebase chỉ có `is_pinned` của `room_members` để ghim hội thoại lên đầu danh sách chat cá nhân, chưa có bảng/cơ chế pin tin nhắn cụ thể trong phòng).
  2. `allow_member_notes_reminders`: Tạo mới ghi chú, nhắc hẹn.
  3. `allow_member_polls`: Tạo mới bình chọn.

---

### c) E2E nhóm & Báo Cáo Hiện Trạng Mã Hóa (TỒN ĐỌNG BẢO MẬT)
- **Cơ chế phân phối phong bì/khóa nhóm hiện tại**:
  - File: [`backend/src/main/java/com/workchat/peer/PeerCore.java#L4831-L5007`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/peer/PeerCore.java#L4831-L5007)
  - Hệ thống WorkChat sử dụng kiến trúc mã hóa E2E theo dạng phong bì riêng rẽ cho từng người nhận (pairwise per-message envelope): Khi gửi tin nhắn tới nhóm, client sinh một khóa đối xứng AES ngẫu nhiên cho tin nhắn đó, lấy danh sách `roomMemberIds(roomId)` từ Tracker, rồi với mỗi thành viên, mã hóa khóa AES đó bằng RSA public key của họ (`wrapOaep`).
  - Hệ thống **KHÔNG dùng khóa đối xứng chung của nhóm (group symmetric key)** và **KHÔNG có cơ chế Group Ratchet / Rekeying (như Signal Sender Keys hay MLS)**.
- **Khi thêm thành viên mới**:
  - Thành viên mới được thêm vào DB (`left_at = NULL`). Ở lần gửi tin kế tiếp, người gửi fetch danh sách thành viên mới và sẽ đóng gói thêm một phong bì mã hóa bằng RSA của thành viên mới.
- **Khi xóa / chặn / rời nhóm**:
  - Bản ghi của thành viên được cập nhật `left_at = NOW()` hoặc `banned_at = NOW()`.
  - Danh sách `roomMemberIds(roomId)` trên Tracker loại bỏ người này. Các tin nhắn phát sinh sau thời điểm đó sẽ không có phong bì RSA cho người bị xóa/chặn.
  - Người bị xóa/chặn không thể giải mã các tin nhắn mới gửi sau đó.
- **TỒN ĐỌNG BẢO MẬT**:
  1. *Lịch sử cục bộ*: Tin nhắn cũ đã nhận trước khi rời/bị xóa vẫn nằm trong cache/SQLite của thiết bị người dùng.
  2. *Độ trễ cập nhật danh sách*: Nếu một thành viên chưa nhận được sự kiện WebSocket `room_updated` và vẫn giữ danh sách thành viên cũ trong vài giây, tin nhắn gửi đi trong cửa sổ thời gian đó vẫn có thể chứa phong bì gửi cho thành viên vừa bị xóa.
  3. *Không có cơ chế Rekeying nhóm*: Do hệ thống không sử dụng shared group secret key mà mã hóa độc lập từng tin nhắn tới từng public key của từng thành viên, nên không có hàm rekey nhóm để gọi khi xóa/chặn. Tồn đọng này được ghi nhận theo đúng hiện trạng kiến trúc E2E hiện hành và không được tự ý sửa đổi thuật toán mã hóa E2E.

---

### d) Sự Kiện Thời Gian Thực (Kênh WebSocket)
- Kênh WebSocket Tracker: [`backend/src/main/java/com/workchat/tracker/ws/ClientRegistry.java`](file:///C:/Users/M.S.I/OneDrive/Pictures/Documents/GitHub/NHOM01-LAPTRINHMANG-P2P/backend/src/main/java/com/workchat/tracker/ws/ClientRegistry.java)
- Sự kiện hiện có:
  - `room_updated`: Gửi dữ liệu phòng cập nhật tới toàn bộ thành viên đang online.
  - `room_added`: Gửi dữ liệu phòng tới thành viên mới vừa được thêm.
  - `room_removed`: Thông báo cho thành viên vừa bị xóa/rời khỏi phòng.
- Sự kiện bổ sung:
  - `join_request_created`: Thông báo cho Owner và Admin khi có yêu cầu phê duyệt mới (cập nhật số đếm badge tức thì).
  - `join_request_resolved`: Thông báo kết quả duyệt/từ chối cho người liên quan và cập nhật badge của Owner/Admin.
  - `room_dissolved`: Thông báo giải tán phòng tới tất cả thành viên.

---

### Kết Luận: Bảng GIỮ / THIẾU
| Đối Tượng | Trạng Thái | Mô Tả |
|---|---|---|
| `rooms` | **GIỮ** | Giữ nguyên các cột hiện tại. |
| `room_members` | **CẬP NHẬT (ALTER)** | Đổi ENUM `room_role` thành `'owner'`, `'admin'`, `'member'`. Leader cũ chuyển thành owner. |
| `room_invites` | **GIỮ** | Dùng cho join link / token. |
| `room_settings` | **THIẾU (TẠO MỚI)** | Lưu cấu hình nhóm: `allow_member_edit_info`, `allow_member_pin`, `allow_member_notes_reminders`, `allow_member_polls`, `allow_member_send`, `require_join_approval`, `highlight_admin_messages`, `new_member_read_recent`, `join_link_enabled`, `join_token`. |
| `join_requests` | **THIẾU (TẠO MỚI)** | Lưu yêu cầu phê duyệt: `room_id`, `user_id`, `invited_by`, `via`, `status` ('pending', 'approved', 'rejected'), `created_at`, `decided_by`, `decided_at`. Unique index `(room_id, user_id, status)`. |
| `room_blocks` | **THIẾU (TẠO MỚI)** | Danh sách chặn khỏi nhóm: `room_id`, `user_id`, `blocked_by`, `blocked_at`, `reason`. Unique index `(room_id, user_id)`. |

---

## 2. Các Quyết Định An Toàn Được Chọn (Default Safe Rules)
1. **Vai trò khi tạo phòng**: Người tạo phòng (`created_by`) được gán vai trò `owner`.
2. **Owner rời nhóm**: Owner không được phép rời nhóm nếu phòng còn thành viên khác mà chưa chuyển vai trò Trưởng nhóm. Nếu chỉ còn duy nhất 1 người (chính Owner) và Owner rời đi, phòng sẽ tự động chuyển sang trạng thái giải tán (`dissolve`).
3. **Phó nhóm (Admin) xóa người**: Admin chỉ có thể xóa các thành viên thường (`member`). Admin không thể xóa Owner và không thể xóa Admin khác.
4. **Tắt cờ `require_join_approval`**: Khi Owner/Admin tắt phê duyệt thành viên mới, các yêu cầu đang ở trạng thái `pending` vẫn được giữ nguyên cho tới khi Owner/Admin bấm Duyệt hoặc Từ chối thủ công (không tự ý auto-approve toàn bộ để tránh sơ suất bảo mật).
5. **Cưỡng chế gửi tin nhắn**: Nếu `allow_member_send = false`, Tracker server từ chối các yêu cầu gửi tin từ `member` với mã lỗi `403 forbidden_member_send` ở cả REST message API (`/api/rooms/{id}/messages`) và Relay E2E Store (`/api/offline/store`). Giao diện ô nhập tin nhắn bị khóa và hiển thị "Chỉ trưởng/phó nhóm được gửi tin".
6. **Mã lỗi phân quyền rõ ràng ở Server**:
   - `403 forbidden_not_owner`: Thao tác chỉ dành cho Trưởng nhóm (giải tán, chuyển trưởng nhóm, bổ nhiệm/bãi nhiệm phó nhóm).
   - `403 forbidden_not_admin`: Thao tác yêu cầu quyền quản trị (Trưởng hoặc Phó nhóm).
   - `403 forbidden_cannot_modify_owner`: Không thể xóa hoặc gỡ quyền của Trưởng nhóm.
   - `403 forbidden_cannot_modify_admin`: Phó nhóm không thể xóa hoặc thao tác trên Phó nhóm khác.
   - `403 forbidden_member_blocked`: Người dùng nằm trong danh sách bị chặn khỏi phòng.
   - `403 forbidden_member_send`: Thành viên thường không có quyền gửi tin nhắn trong nhóm này.
   - `403 forbidden_member_edit_info`: Thành viên thường không có quyền chỉnh sửa thông tin phòng.


---

## 3. Khắc Phục Lỗi Đổi Khóa E2E & Crash JS Trong Chat (Bổ sung)
1. **Lỗi `ReferenceError: outgoingAcksRef is not defined`**:
   - Khai báo `outgoingAcksRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())` trong `useChatMessages.ts` cùng `useEffect` cleanup dọn dẹp timer khi unmount.
2. **Lỗi hiển thị sai thông báo lỗi Modal E2E**:
   - Sửa `res.data?.error` thành `res.error || res.data?.error` trong `E2eChangePassModal.tsx` để hiển thị đúng thông báo lỗi thực tế trả về từ máy chủ thay vì rơi vào chuỗi mặc định gây hiểu nhầm.
3. **Lỗi HTTP 500 khi lưu mã OTP đổi khóa E2E (`e2e_reset`)**:
   - Tạo migration `docs/migrations/008_e2e_reset_otp_purpose.sql` để bổ sung `'e2e_reset'` vào `ENUM purpose` của bảng `otp_codes`.
   - Cập nhật file `schema.sql` đồng bộ.
   - Bọc try-catch `SQLException` tại `HttpRestHandler.java` để bắt lỗi DB và trả về thông báo lỗi rõ ràng nếu DB chưa chạy migration.
