import React, { useState } from "react"
import type { Conversation } from "../../types/chat"

export function useChatSearch(selected: Conversation) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchIdx, setSearchIdx] = useState(0)
  const [searchCurId, setSearchCurId] = useState<number | null>(null)

  const computeSearch = (q: string): number[] => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return selected.messages
      .filter((m) => !m.recalled)
      .filter(
        (m) =>
          m.text.toLowerCase().includes(query) ||
          (m.file ? m.file.name.toLowerCase().includes(query) : false),
      )
      .map((m) => m.id)
  }

  const focusSearchResult = (id: number) => {
    setSearchCurId(id)
    const el = document.getElementById("msg-" + id)
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  const jumpToSearch = (dir: 1 | -1) => {
    const results = computeSearch(searchQuery)
    if (results.length === 0) return
    const next = (searchIdx + dir + results.length) % results.length
    setSearchIdx(next)
    focusSearchResult(results[next])
  }

  const openSearch = () => {
    setSearchOpen(true)
    setSearchQuery("")
    setSearchIdx(0)
    setSearchCurId(null)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery("")
    setSearchIdx(0)
    setSearchCurId(null)
  }

  const highlightBody = (text: string): React.ReactNode => {
    const q = searchOpen ? searchQuery.trim().toLowerCase() : ""
    if (!q || !text) return text
    const lower = text.toLowerCase()
    if (!lower.includes(q)) return text
    const parts: React.ReactNode[] = []
    let last = 0
    let hit = lower.indexOf(q)
    let k = 0
    while (hit !== -1) {
      if (hit > last) parts.push(text.slice(last, hit))
      parts.push(
        <mark
          key={k}
          className="px-0.5 rounded-sm"
          style={{ backgroundColor: "rgba(250,204,21,0.55)", color: "#111" }}
        >
          {text.slice(hit, hit + q.length)}
        </mark>,
      )
      k += 1
      last = hit + q.length
      hit = lower.indexOf(q, last)
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts
  }

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    searchIdx,
    searchCurId,
    setSearchQuery,
    setSearchIdx,
    setSearchCurId,
    computeSearch,
    focusSearchResult,
    jumpToSearch,
    openSearch,
    closeSearch,
    highlightBody,
  }
}
