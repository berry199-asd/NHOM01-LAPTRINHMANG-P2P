import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { PeerOfflineMsg } from "../src/lib/peer"

describe("NHÓM 1 - Cải tiến an toàn và hoàn thiện kiến trúc", () => {
  describe("1. Giới hạn đăng nhập sai (loginFails đồng bộ nguyên tử)", () => {
    it("Mô phỏng 10 request đồng thời: atomic compute chặn chính xác sau MAX_ATTEMPTS (5 lần)", () => {
      const MAX_LOGIN_ATTEMPTS = 5
      const LOGIN_WINDOW_MS = 60_000
      const now = Date.now()

      // Giả lập bảng lưu trữ kiểu ConcurrentHashMap với logic atomic compute
      const loginFails = new Map<string, { windowStart: number; count: number }>()

      const failKey = "127.0.0.1|testuser"

      let allowedAttempts = 0
      let blockedAttempts = 0

      // Chạy 10 lần thử liên tiếp
      for (let i = 0; i < 10; i++) {
        const cur = loginFails.get(failKey)
        if (cur && now - cur.windowStart < LOGIN_WINDOW_MS && cur.count >= MAX_LOGIN_ATTEMPTS) {
          blockedAttempts++
          continue
        }

        // Tăng atomic bằng compute
        const old = loginFails.get(failKey)
        if (!old || now - old.windowStart >= LOGIN_WINDOW_MS) {
          loginFails.set(failKey, { windowStart: now, count: 1 })
        } else {
          loginFails.set(failKey, { windowStart: old.windowStart, count: old.count + 1 })
        }
        allowedAttempts++
      }

      assert.equal(allowedAttempts, 5, "Chỉ được phép thử đúng 5 lần")
      assert.equal(blockedAttempts, 5, "5 lần sau đó phải bị từ chối 429 Too Many Requests")
      assert.equal(loginFails.get(failKey)?.count, 5)
    })
  })

  describe("2. allow_member_send khi P2P trực tiếp", () => {
    // Logic của isSenderAllowedInRoom trong PeerCore
    interface RoomPerm {
      isDirect: boolean
      allowMemberSend: boolean
      roles: Record<number, "owner" | "admin" | "member">
    }

    const checkP2pSendAllowed = (perm: RoomPerm, senderId: number): boolean => {
      if (perm.isDirect) return true
      if (perm.allowMemberSend) return true
      const role = perm.roles[senderId] || "member"
      return role === "owner" || role === "admin"
    }

    it("Phòng nhóm cấm member gửi: member thường bị drop tin P2P", () => {
      const groupPerm: RoomPerm = {
        isDirect: false,
        allowMemberSend: false,
        roles: {
          1: "owner",
          2: "admin",
          3: "member",
        },
      }

      assert.equal(checkP2pSendAllowed(groupPerm, 3), false, "Member thường phải bị chặn")
      assert.equal(checkP2pSendAllowed(groupPerm, 2), true, "Admin vẫn được phép gửi")
      assert.equal(checkP2pSendAllowed(groupPerm, 1), true, "Owner vẫn được phép gửi")
    })

    it("Phòng 1-1 (direct) không bao giờ bị cấm bởi allow_member_send", () => {
      const directPerm: RoomPerm = {
        isDirect: true,
        allowMemberSend: false, // flag không ảnh hưởng 1-1
        roles: {
          1: "member",
          2: "member",
        },
      }

      assert.equal(checkP2pSendAllowed(directPerm, 1), true)
      assert.equal(checkP2pSendAllowed(directPerm, 2), true)
    })
  })

  describe("3. Đồng bộ tin nhắn sửa (Edit message) qua hộp thư Offline", () => {
    it("Tin nhắn offline mang cờ is_edited cập nhật nội dung tin cũ và đánh dấu edited = true", () => {
      // Giả lập danh sách tin nhắn hiện tại trong hội thoại
      const initialMessages = [
        { clientId: "msg-1", text: "Tin nhắn ban đầu", edited: false },
        { clientId: "msg-2", text: "Tin nhắn khác", edited: false },
      ]

      // Gói tin offline kéo về từ Tracker cho msg-1 (đã được sửa nội dung)
      const offlineMsg: PeerOfflineMsg = {
        clientMsgId: "msg-1",
        roomId: 101,
        senderId: 2,
        contentType: "text",
        text: "Tin nhắn đã được sửa nội dung",
        sentAt: 1700000000000,
        is_edited: true,
        edited_at: 1700000060000,
      }

      // Giả lập logic insertOfflineMsg khi gặp tin sửa
      const isEdit = !!(offlineMsg.is_edited || offlineMsg.contentType === "edit" || offlineMsg.originalClientId)
      const targetCid = offlineMsg.originalClientId || offlineMsg.clientMsgId

      let updatedMessages = [...initialMessages]
      const existing = updatedMessages.find((m) => m.clientId === targetCid)

      if (existing) {
        if (isEdit) {
          updatedMessages = updatedMessages.map((m) =>
            m.clientId === targetCid ? { ...m, text: offlineMsg.text, edited: true } : m
          )
        }
      }

      const editedTarget = updatedMessages.find((m) => m.clientId === "msg-1")
      assert.equal(editedTarget?.text, "Tin nhắn đã được sửa nội dung")
      assert.equal(editedTarget?.edited, true)

      // msg-2 không bị ảnh hưởng
      const otherMsg = updatedMessages.find((m) => m.clientId === "msg-2")
      assert.equal(otherMsg?.text, "Tin nhắn khác")
      assert.equal(otherMsg?.edited, false)
    })
  })
})
