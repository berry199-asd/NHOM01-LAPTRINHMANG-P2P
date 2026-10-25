import { Avatar } from "./Avatar"
import { usePersonDirectory } from "../lib/personDirectory"
import type { RoomMember } from "./CreateRoomModal"

export function AvatarStack({
  members,
  max = 4,
}: {
  members: RoomMember[]
  max?: number
}) {
  /** ẢNH THÀNH VIÊN: tra theo id trong thư viện người dùng (cùng nguồn danh sách). */
  const directory = usePersonDirectory()
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  return (
    <div className="flex items-center flex-shrink-0">
      {shown.map((m, i) => (
        <div
          key={m.id}
          style={{
            marginLeft: i === 0 ? 0 : "-10px",
            zIndex: max - i,
            position: "relative",
          }}
          title={m.name}
        >
          <Avatar
            src={directory[m.id]?.avatar || m.avatar}
            initials={m.initials}
            sizePx={36}
            showPresence={false}
            style={{
              backgroundColor: "var(--surface)",
              border: "2px solid var(--bg)",
              color: "var(--text)",
            }}
          />
        </div>
      ))}
      {extra > 0 && (
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold"
          style={{
            backgroundColor: "var(--surface)",
            border: "2px solid var(--bg)",
            color: "var(--muted)",
            marginLeft: "-10px",
            zIndex: 0,
            position: "relative",
          }}
        >
          +{extra}
        </div>
      )}
    </div>
  )
}
