import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  applyGroupCallPresence,
  ongoingCallForRoom,
  pruneExpiredGroupCalls,
  type OngoingGroupCall,
} from "../src/lib/groupCallPresence.ts"
import { shouldFinishCallWithoutRemote } from "../src/lib/webrtc.ts"

/**
 * HỒI QUY 1: cuộc gọi nhóm chỉ còn MỘT người vẫn không tự kết thúc.
 *
 * Nguyên nhân: bên gọi giữ những thành viên chưa nghe máy trong `pendingPeers`, nên điều
 * kiện cũ `roster === 0 && pending === 0` không bao giờ đúng sau khi người duy nhất đã vào
 * cuộc gọi rời đi. Quy tắc mới: đã từng có người khác → roster rỗng là kết thúc.
 */
describe("shouldFinishCallWithoutRemote - tự kết thúc khi chỉ còn một người", () => {
  it("đã từng có người tham gia, họ rời đi, vẫn còn người đang đổ chuông → KẾT THÚC", () => {
    assert.equal(shouldFinishCallWithoutRemote(0, 2, true), true)
  })

  it("chưa ai tham gia, vẫn còn người đang đổ chuông → tiếp tục chờ", () => {
    assert.equal(shouldFinishCallWithoutRemote(0, 2, false), false)
  })

  it("chưa ai tham gia và không còn ai đổ chuông → kết thúc", () => {
    assert.equal(shouldFinishCallWithoutRemote(0, 0, false), true)
  })

  it("còn một người khác đang trong cuộc gọi → KHÔNG kết thúc", () => {
    assert.equal(shouldFinishCallWithoutRemote(1, 3, true), false)
  })

  it("cuộc gọi 1-1: người kia rời đi, không còn ai chờ → kết thúc", () => {
    assert.equal(shouldFinishCallWithoutRemote(0, 0, true), true)
  })
})

const ROOM = 42
const CONV = { id: 1_000_042, name: "Nhóm thử", avatar: "a.png" }
const T0 = 1_800_000_000_000

function frame(overrides: Record<string, unknown> = {}) {
  return {
    callId: "c1-1000",
    roomId: ROOM,
    kind: "voice" as const,
    startedAt: T0,
    callerId: 1,
    callerName: "An",
    fromUserId: 1,
    fromUsername: "an",
    participants: [1, 2],
    ...overrides,
  }
}

/**
 * HỒI QUY 2: người vừa rời cuộc gọi nhóm phải thấy lại nút "Tham gia" trong khi những
 * người khác vẫn đang gọi.
 */
describe("groupCallPresence - trạng thái cuộc gọi nhóm đang diễn ra", () => {
  it("presence hợp lệ tạo bản ghi đúng phòng/callId/người tham gia", () => {
    const next = applyGroupCallPresence({}, frame(), CONV, T0)
    const entry = next[ROOM]
    assert.ok(entry)
    assert.equal(entry.callId, "c1-1000")
    assert.equal(entry.convId, CONV.id)
    assert.equal(entry.name, CONV.name)
    assert.equal(entry.kind, "voice")
    assert.equal(entry.startedAt, T0)
    assert.equal(entry.callerId, 1)
    assert.deepEqual(entry.participantIds, [1, 2])
    assert.ok(entry.expiresAt > T0)
  })

  it("nhịp presence kế tiếp gia hạn hạn dùng và cập nhật người tham gia", () => {
    const first = applyGroupCallPresence({}, frame(), CONV, T0)
    const later = T0 + 4000
    const second = applyGroupCallPresence(
      first,
      frame({ participants: [1, 2, 3] }),
      CONV,
      later,
    )
    assert.deepEqual(second[ROOM].participantIds, [1, 2, 3])
    assert.equal(second[ROOM].expiresAt, later + 15000)
  })

  it("presence còn dưới 2 người → xoá ngay (cuộc gọi không thể duy trì)", () => {
    const first = applyGroupCallPresence({}, frame(), CONV, T0)
    assert.ok(first[ROOM])
    const cleared = applyGroupCallPresence(
      first,
      frame({ participants: [1] }),
      CONV,
      T0 + 1000,
    )
    assert.equal(cleared[ROOM], undefined)
  })

  it("frame thiếu roomId/callId bị bỏ qua, giữ nguyên bản đồ cũ", () => {
    const first = applyGroupCallPresence({}, frame(), CONV, T0)
    assert.equal(
      applyGroupCallPresence(first, frame({ roomId: undefined }), CONV, T0),
      first,
    )
    assert.equal(
      applyGroupCallPresence(first, frame({ callId: undefined }), CONV, T0),
      first,
    )
  })

  it("cuộc gọi mới cùng phòng thay thế bản ghi cũ (không trộn callId)", () => {
    const first = applyGroupCallPresence({}, frame(), CONV, T0)
    const replaced = applyGroupCallPresence(
      first,
      frame({ callId: "c1-2000", startedAt: T0 + 60_000, callerId: 2 }),
      CONV,
      T0 + 60_000,
    )
    assert.equal(replaced[ROOM].callId, "c1-2000")
    assert.equal(replaced[ROOM].startedAt, T0 + 60_000)
    assert.equal(replaced[ROOM].callerId, 2)
  })

  it("bản ghi hết hạn bị dọn và không còn dùng để hiện nút Tham gia", () => {
    const first = applyGroupCallPresence({}, frame(), CONV, T0)
    assert.ok(ongoingCallForRoom(first, ROOM, T0 + 14_000))
    assert.equal(ongoingCallForRoom(first, ROOM, T0 + 15_001), null)
    const pruned = pruneExpiredGroupCalls(first, T0 + 15_001)
    assert.equal(pruned[ROOM], undefined)
  })

  it("prune giữ nguyên object khi chưa có gì hết hạn", () => {
    const first = applyGroupCallPresence({}, frame(), CONV, T0)
    assert.equal(pruneExpiredGroupCalls(first, T0 + 1000), first)
  })

  it("bản ghi cũ hết hạn không ảnh hưởng bản ghi phòng khác", () => {
    let calls: Record<number, OngoingGroupCall> = applyGroupCallPresence(
      {},
      frame(),
      CONV,
      T0,
    )
    calls = applyGroupCallPresence(
      calls,
      frame({ roomId: 99, callId: "c1-3000" }),
      { id: 1_000_099, name: "Nhóm 2" },
      T0 + 5000,
    )
    const pruned = pruneExpiredGroupCalls(calls, T0 + 15_000)
    assert.equal(pruned[ROOM], undefined)
    assert.ok(pruned[99])
  })
})
