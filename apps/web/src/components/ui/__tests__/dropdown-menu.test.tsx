/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

afterEach(() => {
  cleanup()
})

describe('DropdownMenu wrappers', () => {
  it('renders labels, items, checked items, radio items, shortcuts, and submenus', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>Menu label</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem checked>Checked item</DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="radio-a">
              <DropdownMenuRadioItem value="radio-a">Radio item</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger inset>More actions</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem inset>
                  Nested item
                  <DropdownMenuShortcut>Cmd+K</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    expect(screen.getByText('Menu label')).toBeTruthy()
    expect(screen.getByText('Checked item')).toBeTruthy()
    expect(screen.getByText('Radio item')).toBeTruthy()
    expect(screen.getByText('More actions')).toBeTruthy()
    expect(screen.getByText('Nested item')).toBeTruthy()
    expect(screen.getByText('Cmd+K')).toBeTruthy()
  })
})
