import { useState, useEffect } from "react"
import { Login } from "./screens/Login"
import { Register } from "./screens/Register"
import { OTPScreen } from "./screens/OTPScreen"
import { RegisterSuccess } from "./screens/RegisterSuccess"
import { ForgotPassword } from "./screens/ForgotPassword"
import { ResetPassword } from "./screens/ResetPassword"
import { Home } from "./screens/Home"
import { AdminLogin } from "./screens/AdminLogin"
import { AdminDashboard } from "./screens/AdminDashboard"
import { api, getToken, clearToken, type ApiUser } from "./lib/api"
import {
  parseRoute,
  takePendingPath,
  stashPendingPath,
  clearPendingPath,
  type AppRoute,
  type InviteTarget,
} from "./lib/link"

type Screen = "login" | "register" | "otp-register" | "otp-forgot" | "register-success" | "forgot" | "reset" | "home" | "admin-login" | "admin"

function currentRoute(): AppRoute {
  if (typeof window === "undefined") return { kind: "root" }
  return parseRoute(window.location.pathname)
}

function inviteFromRoute(route: AppRoute): InviteTarget | null {
  if (route.kind === "invite-user") return { type: "user", publicId: route.publicId }
  if (route.kind === "invite-room") return { type: "room", code: route.code }
  return null
}

function normalizeToRoot() {
  if (typeof window === "undefined") return
  if (window.location.pathname !== "/") {
    window.history.replaceState(null, "", "/")
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("login")
  const [checking, setChecking] = useState(true)
  const [pendingEmail, setPendingEmail] = useState("")
  const [pendingCode, setPendingCode] = useState("")
  const [adminUser, setAdminUser] = useState<ApiUser | null>(null)
  const [inviteTarget, setInviteTarget] = useState<InviteTarget | null>(() =>
    inviteFromRoute(currentRoute()),
  )
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("darkMode") === "true"
  })

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
    localStorage.setItem("darkMode", String(darkMode))
  }, [darkMode])

  useEffect(() => {
    // Lưu tạm route nội bộ để khôi phục sau khi đăng nhập (deep-link).
    const route = currentRoute()
    if (route.kind !== "root" && typeof window !== "undefined") {
      stashPendingPath(window.location.pathname + window.location.search)
    }
    const token = getToken()
    if (!token) {
      normalizeToRoot()
      setChecking(false)
      return
    }
    api
      .me()
      .then((r) => {
        if (r.ok) {
          clearPendingPath()
          setScreen("home")
        } else {
          clearToken()
          normalizeToRoot()
        }
      })
      .finally(() => setChecking(false))
  }, [])

  const toggleDark = () => setDarkMode((v) => !v)

  const handleLogin = () => {
    const pending = takePendingPath()
    if (pending && typeof window !== "undefined") {
      const route = parseRoute(pending)
      const inv = inviteFromRoute(route)
      if (inv) {
        setInviteTarget(inv)
        window.history.replaceState(null, "", "/")
      } else {
        window.history.replaceState(null, "", pending)
      }
    }
    setScreen("home")
  }

  const handleLogout = () => {
    // Thu hồi phiên phía server (best-effort) trước khi xoá token cục bộ.
    void api.logout()
    clearToken()
    if (typeof window !== "undefined" && window.location.pathname !== "/") {
      window.history.pushState(null, "", "/")
    }
    setScreen("login")
  }

  const consumeInvite = () => {
    setInviteTarget(null)
  }

  if (checking) {
    return (
      <div
        style={{ backgroundColor: "var(--bg)" }}
        className="min-h-screen flex items-center justify-center"
      >
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{
            border: "2px solid var(--border)",
            borderTopColor: "var(--primary)",
          }}
        />
      </div>
    )
  }

  switch (screen) {
    case "login":
      return (
        <Login
          onLogin={handleLogin}
          onNeedsOtp={(email) => {
            setPendingEmail(email)
            setScreen("otp-register")
          }}
          onRegister={() => setScreen("register")}
          onForgot={() => setScreen("forgot")}
          onAdmin={() => setScreen("admin-login")}
        />
      )

    case "admin-login":
      return (
        <AdminLogin
          onLogin={(user) => {
            setAdminUser(user)
            setScreen("admin")
          }}
          onBack={() => setScreen("login")}
        />
      )

    case "admin":
      return <AdminDashboard adminUser={adminUser} onLogout={() => setScreen("admin-login")} />

    case "register":
      return (
        <Register
          onSubmit={(email) => {
            setPendingEmail(email)
            setScreen("otp-register")
          }}
          onLogin={() => setScreen("login")}
        />
      )

    case "otp-register":
      return (
        <OTPScreen
          purpose="register"
          email={pendingEmail}
          onConfirm={() => setScreen("register-success")}
          onBack={() => setScreen("register")}
        />
      )

    case "register-success":
      return <RegisterSuccess onLogin={() => setScreen("login")} />

    case "forgot":
      return (
        <ForgotPassword
          onSubmit={(email) => {
            setPendingEmail(email)
            setScreen("otp-forgot")
          }}
          onBack={() => setScreen("login")}
        />
      )

    case "otp-forgot":
      return (
        <OTPScreen
          purpose="forgot"
          email={pendingEmail}
          onConfirm={(code) => {
            setPendingCode(code)
            setScreen("reset")
          }}
          onBack={() => setScreen("forgot")}
        />
      )

    case "reset":
      return (
        <ResetPassword
          email={pendingEmail}
          code={pendingCode}
          onSubmit={() => {
            setPendingCode("")
            setScreen("login")
          }}
          onBack={() => setScreen("login")}
        />
      )

    case "home":
      return (
        <Home
          darkMode={darkMode}
          onToggleDark={toggleDark}
          onLogout={handleLogout}
          inviteTarget={inviteTarget}
          onInviteConsumed={consumeInvite}
        />
      )
  }
}