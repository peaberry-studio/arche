'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PaperPlaneTilt } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { setWorkspaceStartPrompt } from '@/lib/workspace-start-prompt'

type DashboardHeroProps = {
  slug: string
}

export function DashboardHero({ slug }: DashboardHeroProps) {
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputValue(e.target.value)
    // Auto-resize textarea
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }

  function handleSubmit() {
    const prompt = inputValue.trim()
    if (!prompt) return

    try {
      setWorkspaceStartPrompt(window.sessionStorage, slug, prompt)
    } catch {
      // ignore — if storage is unavailable, fallback is just navigation
    }
    router.push(`/w/${slug}`)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <section className="flex flex-col items-center justify-center px-4 py-16 sm:py-24">
      <h1 className="mb-10 text-center font-[family-name:var(--font-serif)] text-3xl italic text-foreground/90 sm:text-4xl md:text-5xl">
        ¿En qué quieres trabajar hoy?
      </h1>

      <div className="w-full max-w-2xl">
        <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-foreground/5 px-2.5 py-2.5 shadow-subtle">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/60"
            placeholder="Describe what you want to work on..."
            rows={1}
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg"
            disabled={!inputValue.trim()}
            onClick={handleSubmit}
            aria-label="Start working"
          >
            <PaperPlaneTilt size={16} weight="fill" />
          </Button>
        </div>
      </div>
    </section>
  )
}
