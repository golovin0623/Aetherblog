import re

with open('apps/blog/app/components/ArticleFloatingActions.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Desktop TOC open button (motion.button)
content = content.replace(
'''            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => setIsTocOpen((prev) => !prev)}
              className="fixed bottom-24 right-8 z-50 p-2 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-lg transition-all duration-300 group hover:scale-110 active:scale-95 hidden md:flex items-center justify-center focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              aria-label="打开目录"
            >''',
'''            <motion.button
              type="button"
              aria-expanded={isTocOpen}
              aria-controls="desktop-toc-drawer"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => setIsTocOpen((prev) => !prev)}
              className="fixed bottom-24 right-8 z-50 p-2 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-lg transition-all duration-300 group hover:scale-110 active:scale-95 hidden md:flex items-center justify-center focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-body)] focus-visible:outline-none"
              aria-label="打开目录"
            >''')

# 2. Desktop TOC Container ID
content = content.replace(
'''              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.96 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="fixed bottom-40 right-8 z-[100] w-[320px] max-h-[60vh] bg-[var(--bg-card)]/95 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-2xl shadow-2xl shadow-black/20 overflow-hidden flex flex-col hidden md:flex"
              >''',
'''              <motion.div
                id="desktop-toc-drawer"
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.96 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="fixed bottom-40 right-8 z-[100] w-[320px] max-h-[60vh] bg-[var(--bg-card)]/95 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-2xl shadow-2xl shadow-black/20 overflow-hidden flex flex-col hidden md:flex"
              >''')

# 3. Mobile Scroll To Top Inside TOC
content = content.replace(
'''                  {/* 返回顶部 */}
                  <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]/50">
                    <button
                      onClick={() => {
                        setIsTocOpen(false);
                        scrollToTop();
                      }}
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium text-[var(--text-muted)] hover:text-primary hover:bg-primary/5 transition-all duration-300 border border-transparent hover:border-primary/20"
                    >''',
'''                  {/* 返回顶部 */}
                  <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]/50">
                    <button
                      type="button"
                      onClick={() => {
                        setIsTocOpen(false);
                        scrollToTop();
                      }}
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium text-[var(--text-muted)] hover:text-primary hover:bg-primary/5 transition-all duration-300 border border-transparent hover:border-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-xl"
                    >''')

# 4. Desktop Scroll To Top Inside TOC
content = content.replace(
'''                {/* 返回顶部 */}
                <div className="px-5 pb-4 pt-2 border-t border-[var(--border-subtle)]/50">
                  <button
                    onClick={() => {
                      setIsTocOpen(false);
                      scrollToTop();
                    }}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-sm font-medium text-[var(--text-muted)] hover:text-primary hover:bg-primary/5 transition-all duration-300 border border-transparent hover:border-primary/20"
                  >''',
'''                {/* 返回顶部 */}
                <div className="px-5 pb-4 pt-2 border-t border-[var(--border-subtle)]/50">
                  <button
                    type="button"
                    onClick={() => {
                      setIsTocOpen(false);
                      scrollToTop();
                    }}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-sm font-medium text-[var(--text-muted)] hover:text-primary hover:bg-primary/5 transition-all duration-300 border border-transparent hover:border-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-xl"
                  >''')

# 5. Mobile TOC Open Button
content = content.replace(
'''                {/* 目录按钮 */}
                <button
                  onClick={() => setIsTocOpen(true)}
                  className="w-[44px] h-[44px] flex items-center justify-center rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-subtle)] shadow-lg backdrop-blur-xl transition-all duration-300 hover:scale-110 active:scale-95"
                  aria-label="打开目录"
                >''',
'''                {/* 目录按钮 */}
                <button
                  type="button"
                  aria-expanded={isTocOpen}
                  aria-controls="mobile-toc-drawer"
                  onClick={() => setIsTocOpen(true)}
                  className="w-[44px] h-[44px] flex items-center justify-center rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-subtle)] shadow-lg backdrop-blur-xl transition-all duration-300 hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-body)]"
                  aria-label="打开目录"
                >''')

# 6. Mobile Scroll To Top FAB
content = content.replace(
'''                {/* 回顶部按钮 */}
                <button
                  onClick={scrollToTop}
                  className="w-[44px] h-[44px] flex items-center justify-center rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-subtle)] shadow-lg backdrop-blur-xl transition-all duration-300 group hover:scale-110 active:scale-95"
                  aria-label="返回顶部"
                >''',
'''                {/* 回顶部按钮 */}
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="w-[44px] h-[44px] flex items-center justify-center rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-subtle)] shadow-lg backdrop-blur-xl transition-all duration-300 group hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-body)]"
                  aria-label="返回顶部"
                >''')

# 7. Mobile Close TOC Button
content = content.replace(
'''                  <button
                    onClick={() => setIsTocOpen(false)}
                    className="p-1.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all"
                    aria-label="关闭目录"
                  >''',
'''                  <button
                    type="button"
                    onClick={() => setIsTocOpen(false)}
                    className="p-1.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label="关闭目录"
                  >''')

# 8. TOC List items
content = content.replace(
'''        {headings.map((heading) => {
          const isActive = activeId === heading.id;
          return (
            <button
              key={heading.id}
              onClick={() => scrollToHeading(heading.id)}
              className={`group relative block w-full text-left py-2.5 px-4 rounded-lg text-sm transition-all duration-200 ${
                isActive
                  ? 'text-primary bg-primary/5 font-medium'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
              }`}''',
'''        {headings.map((heading) => {
          const isActive = activeId === heading.id;
          return (
            <button
              key={heading.id}
              type="button"
              onClick={() => scrollToHeading(heading.id)}
              className={`group relative block w-full text-left py-2.5 px-4 rounded-lg text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${
                isActive
                  ? 'text-primary bg-primary/5 font-medium'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
              }`}''')


with open('apps/blog/app/components/ArticleFloatingActions.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
