/**
 * @vitest-environment jsdom
 */
import type { MouseEventHandler, ReactNode } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SkillsList } from '../skills-list'

type MockLinkProps = {
  children: ReactNode
  href: string
}

type MockButtonProps = {
  asChild?: boolean
  children: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  type?: 'button' | 'submit' | 'reset'
  variant?: string
}

vi.mock('next/link', () => ({
  default: ({ href, children }: MockLinkProps) => <a href={href}>{children}</a>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, variant, type }: MockButtonProps) => (
    <button type={type} onClick={onClick} data-variant={variant}>
      {children}
    </button>
  ),
}))

describe('SkillsList', () => {
  afterEach(() => {
    cleanup()
  })
  it('renders empty message when there are no skills', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[]}
        isAdmin={false}
        emptyMessage="No skills found."
      />
    )

    expect(screen.getByText('No skills found.')).toBeDefined()
  })

  it('renders skill items with basic info', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          {
            name: 'seo-audit',
            description: 'Run SEO audits',
            assignedAgentIds: ['agent-1'],
            hasResources: false,
            resourcePaths: [],
          },
        ]}
        isAdmin={false}
        emptyMessage="No skills."
      />
    )

    expect(screen.getByText('seo-audit')).toBeDefined()
    expect(screen.getByText('Run SEO audits')).toBeDefined()
  })

  it('renders singular agent count', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 's1', description: 'd1', assignedAgentIds: ['a1'], hasResources: false, resourcePaths: [] },
        ]}
        isAdmin={false}
        emptyMessage="No skills."
      />
    )

    expect(screen.getByText('1 agent')).toBeDefined()
  })

  it('renders plural agent count', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 's1', description: 'd1', assignedAgentIds: ['a1', 'a2'], hasResources: false, resourcePaths: [] },
        ]}
        isAdmin={false}
        emptyMessage="No skills."
      />
    )

    expect(screen.getByText('2 agents')).toBeDefined()
  })

  it('renders SKILL.md only when no resources', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 's1', description: 'd1', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
        ]}
        isAdmin={false}
        emptyMessage="No skills."
      />
    )

    expect(screen.getByText('SKILL.md only')).toBeDefined()
  })

  it('renders bundled file count singular', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 's1', description: 'd1', assignedAgentIds: [], hasResources: true, resourcePaths: ['r1'] },
        ]}
        isAdmin={false}
        emptyMessage="No skills."
      />
    )

    expect(screen.getByText('1 bundled file')).toBeDefined()
  })

  it('renders bundled file count plural', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 's1', description: 'd1', assignedAgentIds: [], hasResources: true, resourcePaths: ['r1', 'r2', 'r3'] },
        ]}
        isAdmin={false}
        emptyMessage="No skills."
      />
    )

    expect(screen.getByText('3 bundled files')).toBeDefined()
  })

  it('renders Export link with correct href', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 'seo', description: 'd', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
        ]}
        isAdmin={false}
        emptyMessage="No skills."
      />
    )

    const exportLink = screen.getByRole('link', { name: 'Export' })
    expect(exportLink.getAttribute('href')).toBe('/api/u/alice/skills/seo/export')
  })

  it('renders Edit button with onClick when isAdmin and onEdit are provided', () => {
    const onEdit = vi.fn()
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 'seo', description: 'd', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
        ]}
        isAdmin={true}
        onEdit={onEdit}
        emptyMessage="No skills."
      />
    )

    const editButton = screen.getByRole('button', { name: 'Edit' })
    expect(editButton).toBeDefined()
    fireEvent.click(editButton)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith('seo')
  })

  it('renders Edit link when isAdmin and no onEdit provided', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 'seo', description: 'd', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
        ]}
        isAdmin={true}
        emptyMessage="No skills."
      />
    )

    const editLink = screen.getByRole('link', { name: 'Edit' })
    expect(editLink).toBeDefined()
    expect(editLink.getAttribute('href')).toBe('/u/alice/skills/seo')
  })

  it('does not render edit controls when not admin', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 'seo', description: 'd', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
        ]}
        isAdmin={false}
        emptyMessage="No skills."
      />
    )

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  })

  it('renders multiple skills in a grid', () => {
    render(
      <SkillsList
        slug="alice"
        skills={[
          { name: 'skill-a', description: 'desc a', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
          { name: 'skill-b', description: 'desc b', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
        ]}
        isAdmin={false}
        emptyMessage="No skills."
      />
    )

    expect(screen.getByText('skill-a')).toBeDefined()
    expect(screen.getByText('skill-b')).toBeDefined()
    expect(screen.getByText('desc a')).toBeDefined()
    expect(screen.getByText('desc b')).toBeDefined()
  })
})
