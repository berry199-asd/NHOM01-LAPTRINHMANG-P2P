import React from "react"
import { Avatar } from "../../components/Avatar"
import { MenuItem } from "../chat/bubbles/MenuItem"

export interface UserMenuDropdownProps {
  profile: { name: string; avatar?: string }
  initials: string
  menuOpen: boolean
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  optionsOpen: boolean
  setOptionsOpen: React.Dispatch<React.SetStateAction<boolean>>
  menuRef: React.RefObject<HTMLDivElement | null>
  onOpenProfile: () => void
  onOpenChangePassword: () => void
  onOpenChangeE2ePassphrase?: () => void
  darkMode: boolean
  onToggleDark: () => void
  onLogout: () => void
}

export function UserMenuDropdown({
  profile,
  initials,
  menuOpen,
  setMenuOpen,
  optionsOpen,
  setOptionsOpen,
  menuRef,
  onOpenProfile,
  onOpenChangePassword,
  onOpenChangeE2ePassphrase,
  darkMode,
  onToggleDark,
  onLogout,
}: UserMenuDropdownProps) {
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => {
          setMenuOpen((v) => !v)
        }}
        className="flex items-center gap-1.5 p-1 rounded-full transition-opacity hover:opacity-80"
      >
        <Avatar
          src={profile.avatar}
          initials={initials}
          size="sm"
          alt={profile.name}
          ring
        />
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: "var(--muted)",
            transform: menuOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-52 rounded-xl py-1.5 z-40 shadow-lg"
          style={{
            backgroundColor: "var(--bg)",
            border: "1px solid var(--border)",
          }}
        >
          <MenuItem
            label="Hồ sơ"
            icon={
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            }
            onClick={() => {
              setMenuOpen(false)
              onOpenProfile()
            }}
          />

          <div>
            <button
              onClick={() => setOptionsOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm transition-colors hover:opacity-70"
              style={{ color: "var(--text)" }}
            >
              <span className="flex items-center gap-2.5">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14" />
                </svg>
                Tùy chọn
              </span>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: optionsOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {optionsOpen && (
              <div className="px-4 pb-2">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    Giao diện tối
                  </span>
                  <button
                    onClick={onToggleDark}
                    className="relative w-10 h-5.5 rounded-full transition-colors flex-shrink-0"
                    style={{
                      width: "40px",
                      height: "22px",
                      backgroundColor: darkMode
                        ? "var(--primary)"
                        : "var(--border)",
                    }}
                  >
                    <span
                      className="absolute top-0.5 rounded-full transition-transform"
                      style={{
                        width: "18px",
                        height: "18px",
                        backgroundColor: darkMode
                          ? "var(--primary-fg)"
                          : "#fff",
                        left: "2px",
                        transform: darkMode
                          ? "translateX(18px)"
                          : "translateX(0)",
                        transition: "transform 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      }}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          <MenuItem
            label="Đổi mật khẩu"
            icon={
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            }
            onClick={() => {
              setMenuOpen(false)
              onOpenChangePassword()
            }}
          />

          {onOpenChangeE2ePassphrase && (
            <MenuItem
              label="Đổi mật khẩu E2E"
              icon={
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              }
              onClick={() => {
                setMenuOpen(false)
                onOpenChangeE2ePassphrase()
              }}
            />
          )}

          <div
            style={{
              height: "1px",
              backgroundColor: "var(--border)",
              margin: "4px 0",
            }}
          />

          <MenuItem
            label="Đăng xuất"
            icon={
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            }
            onClick={onLogout}
            danger
          />
        </div>
      )}
    </div>
  )
}
