import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // .claude/worktrees 안의 작업 사본까지 테스트하지 않는다.
    exclude: [...configDefaults.exclude, '.claude/**', '.superpowers/**'],
  },
})
