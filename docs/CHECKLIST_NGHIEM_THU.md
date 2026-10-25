# BẢNG CHECKLIST NGHIỆM THU THỦ CÔNG (PHÂN QUYỀN VÀ QUẢN LÝ NHÓM)

Dành cho kiểm thử viên / người nghiệm thu hệ thống WorkChat.

---

## 1. Vai trò Trưởng nhóm (Owner)
- [ ] **Màn hình Quản lý nhóm**:
  - [ ] Mở panel Thông tin đoạn chat -> Bấm nút **Quản lý nhóm** hiển thị đầy đủ giao diện.
  - [ ] Có 5 hộp chọn quyền cho thành viên: Đổi tên & ảnh, Ghim, Ghi chú/nhắc hẹn, Bình chọn, Gửi tin nhắn.
  - [ ] Bật/tắt công tắc gửi PATCH `/api/rooms/{id}/settings` thành công, có toast thông báo tiếng Việt.
  - [ ] Dấu hỏi `(?)` giải thích rõ chức năng từng mục khi hover/tap.
  - [ ] Mục link tham gia nhóm: Bật công tắc hiện link nhóm, nút "Sao chép", "Đổi link", "Thu hồi".
  - [ ] Nút đỏ **Giải tán nhóm**: Chỉ Trưởng nhóm nhìn thấy. Khi bấm mở hộp thoại yêu cầu gõ đúng tên nhóm để xác nhận. Sau khi giải tán, phòng bị đóng và thông báo hệ thống được gửi.
- [ ] **Màn hình Thành viên & Phân quyền**:
  - [ ] Menu ba chấm `⋯` hiển thị đầy đủ: "Bổ nhiệm làm Phó nhóm" / "Gỡ Phó nhóm", "Chuyển Trưởng nhóm", "Chặn khỏi nhóm", "Xoá khỏi nhóm".
  - [ ] Bổ nhiệm phó nhóm: Thành viên chuyển role thành `admin`, hiển thị nhãn "Phó nhóm".
  - [ ] Chuyển Trưởng nhóm: Hiển thị hộp thoại cảnh báo "Bạn sẽ trở thành thành viên thường". Sau khi xác nhận, người mới thành `owner`, người cũ thành `member`.
  - [ ] Owner rời phòng: Nếu còn thành viên khác, hệ thống bắt buộc chuyển quyền Trưởng nhóm trước (`must_transfer_owner`).
- [ ] **Màn hình Duyệt thành viên**:
  - [ ] Hiển thị badge số lượng yêu cầu chờ duyệt trên nút Quản lý nhóm và menu Duyệt thành viên.
  - [ ] Thẻ yêu cầu hiển thị: Avatar, Tên hiển thị (không dùng username), Người mời/Qua link, thời gian tương đối.
  - [ ] Nút "Duyệt" và "Từ chối" hoạt động tức thì, cập nhật danh sách không cần reload.
  - [ ] Nút "Duyệt tất cả": Có hộp thoại xác nhận trước khi duyệt đồng loạt.
- [ ] **Màn hình Chặn khỏi nhóm**:
  - [ ] Danh sách thành viên bị chặn kèm người chặn và lý do. Nút "Bỏ chặn" hoạt động bình thường. Người bị chặn không thể vào lại nhóm hoặc tạo yêu cầu tham gia.

---

## 2. Vai trò Phó nhóm (Admin)
- [ ] **Màn hình Quản lý nhóm**:
  - [ ] Điều chỉnh được các cờ cài đặt nhóm và phê duyệt thành viên mới.
  - [ ] KHÔNG nhìn thấy nút "Giải tán nhóm".
- [ ] **Màn hình Thành viên**:
  - [ ] Có thể Xóa và Chặn thành viên thông thường (`member`).
  - [ ] KHÔNG THỂ xóa hoặc chặn Trưởng nhóm (`owner`) hoặc Phó nhóm khác (`admin`) (menu bị ẩn hoặc báo lỗi `403 forbidden_cannot_modify_*`).
  - [ ] KHÔNG THỂ tự phong Trưởng nhóm hay bổ nhiệm Phó nhóm khác.
- [ ] **Duyệt thành viên**:
  - [ ] Có quyền Duyệt / Từ chối yêu cầu tham gia nhóm.
  - [ ] Xử lý đồng thời an toàn: Nếu 2 Phó nhóm cùng bấm duyệt 1 yêu cầu, người bấm sau nhận thông báo "Đã được xử lý bởi..." và danh sách tự cập nhật, không lỗi màn hình.

---

## 3. Vai trò Thành viên (Member)
- [ ] **Hạn chế quản trị**:
  - [ ] Màn hình Quản lý nhóm: Các công tắc cài đặt hiển thị ở dạng chỉ đọc (read-only) hoặc bị ẩn; không thể lưu thay đổi (Server trả về `403 forbidden_not_admin`).
  - [ ] Không có menu quản trị trên người khác (không xóa, không chặn, không đổi vai trò).
- [ ] **Cưỡng chế gửi tin nhắn** (`allow_member_send = false`):
  - [ ] Ô nhập tin nhắn ở khung chat bị khóa (`disabled`).
  - [ ] Placeholder hiển thị rõ: `"Chỉ trưởng/phó nhóm được gửi tin"`.
  - [ ] Các nút gửi file, ảnh, ghi âm, sticker/emoji, nút Send/Like bị vô hiệu hóa với tooltip giải thích.
  - [ ] Nếu gửi qua API Tracker trực tiếp, server trả về `403 forbidden_member_send`.
- [ ] **Cưỡng chế đổi tên / ảnh nhóm** (`allow_member_edit_info = false`):
  - [ ] Giao diện ẩn/khóa nút đổi tên và thay ảnh đại diện nhóm. Server trả về `403 forbidden_member_edit_info`.
- [ ] **Phê duyệt khi vào nhóm** (`require_join_approval = true`):
  - [ ] Member thêm bạn bè vào nhóm -> Không vào thẳng, hệ thống tạo yêu cầu chờ duyệt (`join_requests`).
  - [ ] Tham gia qua link nhóm -> Chờ Trưởng/Phó nhóm duyệt.
  - [ ] Khi được duyệt -> Nhận thông báo và vào nhóm, xem tin nhắn bình thường.

---

## 4. Hiển thị Khung Chat & Hệ thống
- [ ] **Tin hệ thống**:
  - [ ] Các thao tác (thêm người, bổ nhiệm phó nhóm, đổi cài đặt, rời nhóm, chuyển trưởng nhóm) hiển thị dạng chữ nhỏ căn giữa khung chat (`bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] rounded-full`).
- [ ] **Đánh dấu Trưởng / Phó nhóm**:
  - [ ] Khi `highlight_admin_messages = true`: Tin nhắn của Trưởng nhóm có nhãn nhỏ `"Trưởng nhóm"` màu primary, Phó nhóm có nhãn `"Phó nhóm"`.
- [ ] **Giao diện & Theme**:
  - [ ] Toàn bộ sử dụng CSS Variables token của WorkChat (`--bg`, `--surface`, `--primary`, `--border`, `--text`, `--muted`, `--error`).
  - [ ] Chuyển đổi Dark / Light mode tương phản tốt, không bị hardcode màu tím Zalo hay logo Zalo.
  - [ ] Hỗ trợ phím Escape đóng modal, aria-label tiếng Việt, responsive hoàn toàn trên điện thoại màn hình nhỏ.
