-- Minimal nvim for the recording: the vercel.nvim colorscheme, no plugins, and
-- a typist that feeds keys one at a time so an edit is watchable.
local theme = vim.env.DEMO_THEME_DIR

if theme ~= nil and theme ~= "" then
  vim.opt.runtimepath:prepend(theme)
end

vim.o.swapfile = false
vim.o.termguicolors = true
vim.o.background = "dark"
vim.o.number = true
vim.o.signcolumn = "no"
vim.o.laststatus = 2
vim.o.showmode = true
vim.o.autoindent = false
vim.o.smartindent = false
vim.o.expandtab = true
vim.o.shortmess = vim.o.shortmess .. "I"

-- A filetype plugin would re-indent the lines the typist writes, or continue a
-- comment leader onto the line after one.
vim.api.nvim_create_autocmd("FileType", {
  callback = function()
    vim.bo.indentexpr = ""
    vim.bo.autoindent = false
    vim.bo.smartindent = false
    vim.bo.cindent = false
    vim.bo.formatoptions = "tq"
  end,
})

require("vercel").setup({ theme = "dark" })
vim.cmd.colorscheme("vercel")
