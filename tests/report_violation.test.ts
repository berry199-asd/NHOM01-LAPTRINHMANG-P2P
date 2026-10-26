import test from "node:test"
import assert from "node:assert/strict"

test("Quản lý Báo cáo vi phạm - Tạo báo cáo và cấu trúc dữ liệu gửi Admin", async () => {
  const reportsDb: any[] = []

  function mockCreateReport(reporterId: number, targetType: string, targetId: string, reason: string, evidenceNote?: string) {
    if (!targetType || !targetId) {
      throw new Error("missing_target")
    }
    const record = {
      id: reportsDb.length + 1,
      reporter_id: reporterId,
      target_type: targetType,
      target_id: targetId,
      reason: reason || "Báo cáo vi phạm",
      evidence_note: evidenceNote || null,
      status: "pending",
      created_at: Date.now(),
    }
    reportsDb.push(record)
    return { ok: true, id: record.id }
  }

  // 1. Tạo báo cáo người dùng với ghi chú vi phạm
  const res1 = mockCreateReport(101, "user", "102", "Báo cáo người dùng Trần Ngọc Ánh Phương", "Gửi tin nhắn quấy rối")
  assert.equal(res1.ok, true)
  assert.equal(res1.id, 1)

  // 2. Tạo báo cáo nhóm
  const res2 = mockCreateReport(101, "room", "501", "Báo cáo nhóm Hậu cung Chân Hoàn truyện", "Nhóm có nội dung không phù hợp")
  assert.equal(res2.ok, true)
  assert.equal(res2.id, 2)

  // 3. Admin lọc báo cáo chờ xử lý (pending)
  const pending = reportsDb.filter((r) => r.status === "pending")
  assert.equal(pending.length, 2)
  assert.equal(pending[0].evidence_note, "Gửi tin nhắn quấy rối")

  // 4. Admin xử lý báo cáo
  reportsDb[0].status = "resolved"
  const pendingAfter = reportsDb.filter((r) => r.status === "pending")
  assert.equal(pendingAfter.length, 1)
  assert.equal(pendingAfter[0].id, 2)
})
