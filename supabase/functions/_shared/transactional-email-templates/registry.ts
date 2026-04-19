/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as gradeWelcome } from './grade-welcome.tsx'
import { template as dailyPickDrop } from './daily-pick-drop.tsx'
import { template as day7Upgrade } from './day-7-upgrade.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'grade-welcome': gradeWelcome,
  'daily-pick-drop': dailyPickDrop,
  'day-7-upgrade': day7Upgrade,
}
