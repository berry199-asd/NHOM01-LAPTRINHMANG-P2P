import { useState } from "react"
import { Overview } from "../components/admin/Overview"
import { Accounts } from "../components/admin/Accounts"
import { OnlineMonitor } from "../components/admin/OnlineMonitor"
import { SystemLogs } from "../components/admin/SystemLogs"
import { ViolationReports } from "../components/admin/ViolationReports"
import { SystemNotice } from "../components/admin/SystemNotice"
import { SystemConfig } from "../components/admin/SystemConfig"
import type { ApiUser } from "../lib/api"

type Section = "overview" | "accounts" | "online" | "logs" | "reports" | "notices" | "config"

const NAV_ITEMS: { key: Section; label: string }[] = [
  { key: "overview", label: "Tổng quan" },
  { key: "accounts", label: "Tài khoản người dùng" },
  { key: "online", label: "Giám sát Online" },
  { key: "logs", label: "Nhật ký hệ thống" },
  { key: "reports", label: "Báo cáo vi phạm" },
  { key: "notices", label: "Thông báo hệ thống" },
  { key: "config", label: "Cấu hình" },
]

const TITLES: Record<Section, string> = {
  overview: "Tổng quan",
  accounts: "Tài khoản người dùng",
  online: "Giám sát Online",
  logs: "Nhật ký hệ thống",
  reports: "Báo cáo vi phạm",
  notices: "Thông báo hệ thống",
  config: "Cấu hình hệ thống",
}

interface Props {
  adminUser: ApiUser | null
  onLogout: () => void
}

function makeInitials(user: ApiUser | null): string {
  const src = user?.display_name?.trim() || user?.email?.split("@")[0] || ""
  if (!src) return "AD"
  const parts = src.split(/[\s._-]+/).filter(Boolean)
  const letters = (parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2))
  return letters.toUpperCase()
}

export function AdminDashboard({ adminUser, onLogout }: Props) {
  const [section, setSection] = useState<Section>("overview")
  const adminName = adminUser?.display_name?.trim() || adminUser?.email?.split("@")[0] || "Admin"
  const adminEmail = adminUser?.email ?? ""

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--bg)" }}>
      {/* Sidebar */}
      <aside
        className="w-60 flex-shrink-0 flex flex-col"
        style={{ borderRight: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center gap-2 px-4 h-14 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div
            className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-fg)",
            }}
          >
            W
          </div>
          <div className="flex flex-col leading-tight">
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--text)" }}
            >
              WorkChat
            </span>
            <span className="text-[10px]" style={{ color: "var(--muted)" }}>
              Admin Console
            </span>
          </div>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setSection(item.key)}
              className="w-full text-left px-4 py-2.5 text-sm transition-opacity hover:opacity-80"
              style={{
                color: section === item.key ? "var(--text)" : "var(--muted)",
                backgroundColor:
                  section === item.key ? "var(--surface)" : "transparent",
                borderRight:
                  section === item.key
                    ? "2px solid var(--primary)"
                    : "2px solid transparent",
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div
          className="px-4 py-3 flex-shrink-0 flex items-center gap-2"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            {makeInitials(adminUser)}
          </div>
          <div className="flex flex-col leading-tight flex-1 min-w-0">
            <span
              className="text-sm font-medium truncate"
              style={{ color: "var(--text)" }}
            >
              {adminName}
            </span>
            <span
              className="text-[10px] truncate"
              style={{ color: "var(--muted)" }}
            >
              {adminEmail}
            </span>
          </div>
          <button
            onClick={onLogout}
            className="text-xs font-medium px-2 py-1 rounded-md transition-opacity hover:opacity-70 flex-shrink-0"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
            }}
          >
            Đăng xuất
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header
          className="px-6 h-14 flex items-center flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h1
            className="text-base font-semibold"
            style={{ color: "var(--text)" }}
          >
            {TITLES[section]}
          </h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {section === "overview" && <Overview />}
          {section === "accounts" && <Accounts />}
          {section === "online" && <OnlineMonitor />}
          {section === "logs" && <SystemLogs />}
          {section === "reports" && <ViolationReports />}
          {section === "notices" && <SystemNotice />}
          {section === "config" && <SystemConfig />}
        </div>
      </main>
    </div>
  )
}
