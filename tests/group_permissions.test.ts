import { describe, it } from "node:test"
import assert from "node:assert/strict"

// Mô phỏng ma trận quyền của Tracker Server và Client
describe("Group Permissions Matrix (Ma Trận Quyền Nhóm)", () => {
  type Role = "owner" | "admin" | "member"

  interface ActionContext {
    actorRole: Role
    targetRole?: Role
    allowMemberSend?: boolean
    allowMemberEditInfo?: boolean
    action:
      | "transfer_owner"
      | "dissolve_room"
      | "change_role"
      | "change_settings"
      | "remove_member"
      | "block_member"
      | "unblock_member"
      | "approve_join"
      | "edit_info"
      | "send_message"
      | "leave_room"
    roomMemberCount?: number
  }

  function checkPermission(ctx: ActionContext): { allowed: boolean; errorCode?: string } {
    const { actorRole, targetRole, action, allowMemberSend = true, allowMemberEditInfo = true, roomMemberCount = 2 } = ctx

    if (action === "send_message") {
      if (actorRole === "owner" || actorRole === "admin") return { allowed: true }
      if (!allowMemberSend) return { allowed: false, errorCode: "forbidden_member_send" }
      return { allowed: true }
    }

    if (action === "edit_info") {
      if (actorRole === "owner" || actorRole === "admin") return { allowed: true }
      if (!allowMemberEditInfo) return { allowed: false, errorCode: "forbidden_member_edit_info" }
      return { allowed: true }
    }

    if (action === "leave_room") {
      if (actorRole === "owner" && roomMemberCount > 1) {
        return { allowed: false, errorCode: "must_transfer_owner" }
      }
      return { allowed: true }
    }

    if (action === "dissolve_room" || action === "transfer_owner") {
      if (actorRole !== "owner") return { allowed: false, errorCode: "forbidden_not_owner" }
      return { allowed: true }
    }

    if (action === "change_role") {
      if (actorRole !== "owner") return { allowed: false, errorCode: "forbidden_not_owner" }
      if (targetRole === "owner") return { allowed: false, errorCode: "forbidden_cannot_modify_owner" }
      return { allowed: true }
    }

    if (action === "change_settings") {
      if (actorRole === "member") return { allowed: false, errorCode: "forbidden_not_admin" }
      return { allowed: true }
    }

    if (action === "approve_join") {
      if (actorRole === "member") return { allowed: false, errorCode: "forbidden_not_admin" }
      return { allowed: true }
    }

    if (action === "remove_member" || action === "block_member") {
      if (actorRole === "member") return { allowed: false, errorCode: "forbidden_not_admin" }
      if (targetRole === "owner") return { allowed: false, errorCode: "forbidden_cannot_modify_owner" }
      if (targetRole === "admin" && actorRole !== "owner") return { allowed: false, errorCode: "forbidden_cannot_modify_admin" }
      return { allowed: true }
    }

    if (action === "unblock_member") {
      if (actorRole === "member") return { allowed: false, errorCode: "forbidden_not_admin" }
      return { allowed: true }
    }

    return { allowed: false, errorCode: "unknown_action" }
  }

  it("Owner có toàn quyền quản trị cao nhất", () => {
    assert.deepEqual(checkPermission({ actorRole: "owner", action: "transfer_owner" }), { allowed: true })
    assert.deepEqual(checkPermission({ actorRole: "owner", action: "dissolve_room" }), { allowed: true })
    assert.deepEqual(checkPermission({ actorRole: "owner", targetRole: "admin", action: "change_role" }), { allowed: true })
    assert.deepEqual(checkPermission({ actorRole: "owner", targetRole: "member", action: "change_role" }), { allowed: true })
    assert.deepEqual(checkPermission({ actorRole: "owner", targetRole: "admin", action: "remove_member" }), { allowed: true })
    assert.deepEqual(checkPermission({ actorRole: "owner", targetRole: "member", action: "block_member" }), { allowed: true })
    assert.deepEqual(checkPermission({ actorRole: "owner", action: "change_settings" }), { allowed: true })
  })

  it("Admin KHÔNG thể xóa hoặc chặn Owner", () => {
    const resRemove = checkPermission({ actorRole: "admin", targetRole: "owner", action: "remove_member" })
    assert.equal(resRemove.allowed, false)
    assert.equal(resRemove.errorCode, "forbidden_cannot_modify_owner")

    const resBlock = checkPermission({ actorRole: "admin", targetRole: "owner", action: "block_member" })
    assert.equal(resBlock.allowed, false)
    assert.equal(resBlock.errorCode, "forbidden_cannot_modify_owner")
  })

  it("Admin KHÔNG thể xóa hoặc chặn Admin khác", () => {
    const resRemove = checkPermission({ actorRole: "admin", targetRole: "admin", action: "remove_member" })
    assert.equal(resRemove.allowed, false)
    assert.equal(resRemove.errorCode, "forbidden_cannot_modify_admin")

    const resBlock = checkPermission({ actorRole: "admin", targetRole: "admin", action: "block_member" })
    assert.equal(resBlock.allowed, false)
    assert.equal(resBlock.errorCode, "forbidden_cannot_modify_admin")
  })

  it("Admin có thể xóa hoặc chặn Member thông thường", () => {
    const resRemove = checkPermission({ actorRole: "admin", targetRole: "member", action: "remove_member" })
    assert.equal(resRemove.allowed, true)

    const resBlock = checkPermission({ actorRole: "admin", targetRole: "member", action: "block_member" })
    assert.equal(resBlock.allowed, true)
  })

  it("Admin KHÔNG thể giải tán phòng hoặc bổ nhiệm/bãi nhiệm phó nhóm", () => {
    assert.equal(checkPermission({ actorRole: "admin", action: "dissolve_room" }).allowed, false)
    assert.equal(checkPermission({ actorRole: "admin", action: "transfer_owner" }).allowed, false)
    assert.equal(checkPermission({ actorRole: "admin", targetRole: "member", action: "change_role" }).allowed, false)
  })

  it("Cưỡng chế gửi tin nhắn khi allow_member_send = false", () => {
    // Member bị chặn
    const memberSend = checkPermission({ actorRole: "member", action: "send_message", allowMemberSend: false })
    assert.equal(memberSend.allowed, false)
    assert.equal(memberSend.errorCode, "forbidden_member_send")

    // Admin vẫn gửi được
    const adminSend = checkPermission({ actorRole: "admin", action: "send_message", allowMemberSend: false })
    assert.equal(adminSend.allowed, true)

    // Owner vẫn gửi được
    const ownerSend = checkPermission({ actorRole: "owner", action: "send_message", allowMemberSend: false })
    assert.equal(ownerSend.allowed, true)
  })

  it("Cưỡng chế đổi tên và ảnh nhóm khi allow_member_edit_info = false", () => {
    const memberEdit = checkPermission({ actorRole: "member", action: "edit_info", allowMemberEditInfo: false })
    assert.equal(memberEdit.allowed, false)
    assert.equal(memberEdit.errorCode, "forbidden_member_edit_info")

    const adminEdit = checkPermission({ actorRole: "admin", action: "edit_info", allowMemberEditInfo: false })
    assert.equal(adminEdit.allowed, true)
  })

  it("Owner rời nhóm khi còn thành viên khác bắt buộc phải chuyển quyền trước", () => {
    const res = checkPermission({ actorRole: "owner", action: "leave_room", roomMemberCount: 3 })
    assert.equal(res.allowed, false)
    assert.equal(res.errorCode, "must_transfer_owner")

    // Khi chỉ có 1 mình owner thì được phép rời (và tự động giải tán phòng)
    const soloRes = checkPermission({ actorRole: "owner", action: "leave_room", roomMemberCount: 1 })
    assert.equal(soloRes.allowed, true)
  })
})

describe("Join Requests & Concurrency (Phê Duyệt Thành Viên & Xử Lý Đồng Thời)", () => {
  interface JoinRequest {
    id: number
    roomId: number
    userId: number
    status: "pending" | "approved" | "rejected"
    createdAt: number
    decidedBy?: number
    decidedAt?: number
  }

  function isRequestExpired(req: JoinRequest, now: number = Date.now()): boolean {
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000
    return now - req.createdAt > FOURTEEN_DAYS_MS
  }

  function resolveRequest(
    req: JoinRequest,
    action: "approve" | "reject",
    adminId: number,
  ): { success: boolean; errorCode?: string; updatedReq?: JoinRequest } {
    if (req.status !== "pending") {
      return { success: false, errorCode: "already_decided" }
    }
    if (isRequestExpired(req)) {
      return { success: false, errorCode: "request_expired" }
    }
    const updated: JoinRequest = {
      ...req,
      status: action === "approve" ? "approved" : "rejected",
      decidedBy: adminId,
      decidedAt: Date.now(),
    }
    return { success: true, updatedReq: updated }
  }

  it("Yêu cầu phê duyệt tự động hết hạn sau 14 ngày", () => {
    const now = 1700000000000
    const freshReq: JoinRequest = {
      id: 1,
      roomId: 10,
      userId: 100,
      status: "pending",
      createdAt: now - 5 * 24 * 60 * 60 * 1000, // 5 ngày trước
    }
    assert.equal(isRequestExpired(freshReq, now), false)

    const expiredReq: JoinRequest = {
      id: 2,
      roomId: 10,
      userId: 101,
      status: "pending",
      createdAt: now - 15 * 24 * 60 * 60 * 1000, // 15 ngày trước
    }
    assert.equal(isRequestExpired(expiredReq, now), true)

    const resolveExpired = resolveRequest(expiredReq, "approve", 999)
    assert.equal(resolveExpired.success, false)
    assert.equal(resolveExpired.errorCode, "request_expired")
  })

  it("Xử lý đồng thời (Concurrency Safe): Admin 2 không bị lỗi trắng màn hình nếu Admin 1 đã duyệt trước", () => {
    let req: JoinRequest = {
      id: 10,
      roomId: 5,
      userId: 200,
      status: "pending",
      createdAt: Date.now(),
    }

    // Admin A duyệt trước
    const resA = resolveRequest(req, "approve", 1)
    assert.equal(resA.success, true)
    req = resA.updatedReq!

    // Admin B duyệt ngay sau đó
    const resB = resolveRequest(req, "approve", 2)
    assert.equal(resB.success, false)
    assert.equal(resB.errorCode, "already_decided")
  })
})
