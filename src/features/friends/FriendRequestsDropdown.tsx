import React from "react"
import type { FriendRequest } from "../../types/chat"

export interface FriendRequestsDropdownProps {
  friendReqRef: React.RefObject<HTMLDivElement | null>
  friendReqOpen: boolean
  setFriendReqOpen: React.Dispatch<React.SetStateAction<boolean>>
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  friendRequests: FriendRequest[]
  inviteTab: "friends" | "rooms"
  setInviteTab: React.Dispatch<React.SetStateAction<"friends" | "rooms">>
  acceptRequest: (id: number) => void
  rejectRequest: (id: number) => void
  joinCode: string
  setJoinCode: (code: string) => void
  joinByCode: () => void
  joining: boolean
}

export function FriendRequestsDropdown({
  friendReqRef,
  friendReqOpen,
  setFriendReqOpen,
  setMenuOpen,
  friendRequests,
  inviteTab,
  setInviteTab,
  acceptRequest,
  rejectRequest,
  joinCode,
  setJoinCode,
  joinByCode,
  joining,
}: FriendRequestsDropdownProps) {
  return (
    <div className="relative" ref={friendReqRef}>
      <button
        onClick={() => {
          setFriendReqOpen((v) => !v)
          setMenuOpen(false)
        }}
        title="Lời mời kết bạn"
        className="p-2 rounded-md transition-opacity hover:opacity-60 relative"
        style={{ color: "var(--muted)" }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
        {friendRequests.length > 0 && (
          <span
            className="absolute top-1 right-1 w-4 h-4 rounded-full text-white flex items-center justify-center"
            style={{
              backgroundColor: "#ef4444",
              fontSize: "9px",
              fontWeight: 600,
            }}
          >
            {friendRequests.length}
          </span>
        )}
      </button>
      {friendReqOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-72 rounded-xl py-2 z-40 shadow-lg"
          style={{
            backgroundColor: "var(--bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="flex gap-4 px-4 pt-1 pb-2"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <button
              onClick={() => setInviteTab("friends")}
              className="text-xs font-semibold pb-1.5 transition-colors"
              style={{
                color:
                  inviteTab === "friends" ? "var(--text)" : "var(--muted)",
                borderBottom:
                  inviteTab === "friends"
                    ? "2px solid var(--primary)"
                    : "2px solid transparent",
              }}
            >
              Kết bạn ({friendRequests.length})
            </button>
            <button
              onClick={() => setInviteTab("rooms")}
              className="text-xs font-semibold pb-1.5 transition-colors"
              style={{
                color: inviteTab === "rooms" ? "var(--text)" : "var(--muted)",
                borderBottom:
                  inviteTab === "rooms"
                    ? "2px solid var(--primary)"
                    : "2px solid transparent",
              }}
            >
              Tham gia bằng mã
            </button>
          </div>
          {inviteTab === "friends" ? (
            <>
              {friendRequests.length === 0 ? (
                <p
                  className="text-sm text-center py-4"
                  style={{ color: "var(--muted)" }}
                >
                  Không có lời mời nào
                </p>
              ) : (
                friendRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                      style={{
                        backgroundColor: "var(--surface)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    >
                      {req.initials}
                    </div>
                    <span
                      className="flex-1 text-sm font-medium truncate"
                      style={{ color: "var(--text)" }}
                    >
                      {req.name}
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => acceptRequest(req.id)}
                        className="px-2.5 py-1 text-xs font-semibold rounded-md transition-opacity hover:opacity-80"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        Đồng ý
                      </button>
                      <button
                        onClick={() => rejectRequest(req.id)}
                        className="px-2.5 py-1 text-xs font-medium rounded-md transition-opacity hover:opacity-70"
                        style={{
                          border: "1px solid var(--border)",
                          color: "var(--muted)",
                        }}
                      >
                        Từ chối
                      </button>
                    </div>
                  </div>
                ))
              )}
            </>
          ) : (
            <div className="px-4 py-3">
              <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                Nhập mã phòng hoặc dán liên kết /r/...
              </p>
              <div className="flex gap-1.5">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") joinByCode()
                  }}
                  placeholder="Mã phòng"
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-md outline-none"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                />
                <button
                  onClick={joinByCode}
                  disabled={joining || !joinCode.trim()}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-fg)",
                  }}
                >
                  {joining ? "Đang vào..." : "Tham gia"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
