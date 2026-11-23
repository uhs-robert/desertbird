# Keymap

The default keys of DesertBird, generated from the command table in `src/background/commands/`. Do not edit between the markers. Run `npm run docs:gen` after a change to a binding. `npm run check` fails when the tables are stale.

Each tab kind has its own table, because a tab gets only the keys whose commands it can serve. A single key that is missing from a table reaches Thunderbird. In a message or own-page tab, a missing mail sequence such as `m R` is consumed and does nothing, so it never runs its tail as a key of its own. Tables split by which-key group. A key has the group of its longest named prefix, so `g a` is under Go and `j` is under Single keys. A key you set in the options page or in the keys editor goes on top of these defaults.

A command shows in the long form the command line takes. A note "(prompts)" means the binding sets a `prompt` for a param, so the command line asks for it.

<!-- BEGIN generated -->

bound: 445 (Mail tab 151, Message 98, Message window 80, Compose window 13, Own pages 50, Other tabs 49, Text fields 4)

### Mail tab

The thread list and the folder pane.

#### Single keys

| Key | Command |
| --- | --- |
| `j` | `motion.down` |
| `k` | `motion.up` |
| `G` | `motion.bottom` |
| `.` | `repeat.last` |
| `v` | `visual.toggle` |
| `a` | `msg.archive` |
| `r` | `msg.reply` |
| `R` | `msg.reply --all` |
| `c` | `msg.new` |
| `<C-l>` | `msg.open` |
| `J` | `tab.next` |
| `K` | `tab.prev` |
| `<A-j>` | `tab.next` |
| `<A-k>` | `tab.prev` |
| `q` | `tab.close` |
| `<C-x>` | `tab.close_mail` |
| `<C-c>` | `tab.close_mail` |
| `<A-q>` | `tab.close` |
| `:` | `cmdline.open` |
| `o` | `cmdline.open 'open '` |
| `T` | `cmdline.open 'tab '` |
| `<C-o>` | `jump.back` |
| `<C-i>` | `jump.forward` |
| `M` | `mark.set` |
| `'` | `mark.jump` |
| `h` | `motion.left` |
| `l` | `motion.right` |
| `<C-d>` | `view.half_page next` |
| `<C-u>` | `view.half_page previous` |
| `u` | `undo` |
| `H` | `pane.left` |
| `<A-h>` | `pane.left` |
| `L` | `pane.right` |
| `<A-l>` | `pane.right` |
| `/` | `search.open forward` |
| `?` | `search.open backward` |
| `n` | `search.next` |
| `N` | `search.prev` |
| `f` | `hint` |

#### Go

| Key | Command |
| --- | --- |
| `gg` | `motion.top` |
| `gF` | `msg.forward` |
| `gi` | `open --inbox` |
| `gt` | `open --trash` |
| `gd` | `open --drafts` |
| `gs` | `open --sent` |
| `gu` | `msg.unsubscribe` |
| `ga` | `msg.save_attachments` |
| `g?` | `help.whichkey` |
| `gC` | `thread.open_conversation` |
| `gf` | `pane.focus folders` |
| `ge` | `pane.focus threads` |
| `gm` | `pane.focus message` |

#### Quick reply

| Key | Command |
| --- | --- |
| `gr1` | `msg.reply_with 1` |
| `gr2` | `msg.reply_with 2` |
| `gr3` | `msg.reply_with 3` |
| `gr4` | `msg.reply_with 4` |
| `gr5` | `msg.reply_with 5` |
| `gr6` | `msg.reply_with 6` |
| `gr7` | `msg.reply_with 7` |
| `gr8` | `msg.reply_with 8` |
| `gr9` | `msg.reply_with 9` |

#### Pages

| Key | Command |
| --- | --- |
| `gpa` | `app.open_page addons` |
| `gpt` | `app.open_page themes` |
| `gpc` | `app.open_page config` |

#### Message

| Key | Command |
| --- | --- |
| `mr` | `msg.read --read` |
| `mu` | `msg.read --unread` |
| `mR` | `folder.read_all` |
| `ms` | `msg.flag` |
| `mj` | `msg.junk` |
| `mt` | `cmdline.open 'tag '` |
| `mm` | `cmdline.open 'move '` |
| `mc` | `cmdline.open 'copy '` |

#### Snooze

| Key | Command |
| --- | --- |
| `mzl` | `msg.snooze later_today` |
| `mzt` | `msg.snooze tomorrow` |
| `mzw` | `msg.snooze weekend` |
| `mzm` | `msg.snooze monday` |

#### Remind

| Key | Command |
| --- | --- |
| `mfd` | `msg.remind one_day` |
| `mft` | `msg.remind three_days` |
| `mfw` | `msg.remind one_week` |
| `mfc` | `msg.remind_cancel` |

#### Filter

| Key | Command |
| --- | --- |
| `Fu` | `filter --unread` |
| `Fr` | `filter --all` |
| `Fs` | `filter --toggle-starred` |
| `Fa` | `filter --attachment` |
| `Ff` | `cmdline.open 'filter '` |
| `Ft` | `cmdline.open filter --tag --tag=` |

#### By message

| Key | Command |
| --- | --- |
| `Fmf` | `filter-by from` |
| `Fms` | `filter-by subject` |
| `Fmr` | `filter-by recipient` |
| `Fmt` | `filter-by tag` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help.open` |
| `,s` | `options` |
| `,?` | `help.whichkey` |

#### Sort

| Key | Command |
| --- | --- |
| `sd` | `sort --date --descending` |
| `sj` | `sort --subject --ascending` |
| `sf` | `sort --author --ascending` |
| `sz` | `sort --size --ascending` |
| `st` | `sort --tags --ascending` |
| `sa` | `sort --attachments --ascending` |
| `su` | `sort --unread --ascending` |
| `sr` | `sort --received --descending` |
| `sp` | `sort --priority --ascending` |
| `so` | `sort --current --toggle` |
| `ss` | `cmdline.open 'sort '` |

#### Tabs

| Key | Command |
| --- | --- |
| `tn` | `tab.next` |
| `tp` | `tab.prev` |
| `t0` | `tab 1` |
| `t$` | `tab.goto -1` |
| `tl` | `tab.alternate` |
| `tm` | `cmdline.open 'tab.move '` |
| `tM` | `cmdline.open tab.move --offset=` |
| `tT` | `cmdline.open 'tab '` |

#### Panes

| Key | Command |
| --- | --- |
| `wr` | `pane.resize_mode` |
| `wm` | `pane.toggle message` |
| `wf` | `pane.toggle folder` |
| `wh` | `pane.left` |
| `wl` | `pane.right` |

#### Zoom and scroll

| Key | Command |
| --- | --- |
| `zz` | `view.reposition center` |
| `zt` | `view.reposition top` |
| `zb` | `view.reposition bottom` |
| `zM` | `thread.fold_all --open=false` |
| `zR` | `thread.fold_all --open` |
| `zi` | `zoom.by 0.1` |
| `z+` | `zoom.by 0.1` |
| `zo` | `zoom.by -0.1` |
| `z-` | `zoom.by -0.1` |
| `zm` | `zoom.by 0.5` |
| `zr` | `zoom.by -0.5` |
| `z=` | `zoom 1` |
| `zI` | `zoom 3` |
| `zO` | `zoom 0.3` |

#### Copy

| Key | Command |
| --- | --- |
| `yy` | `msg.yank` |
| `ys` | `msg.yank --subject` |
| `yf` | `msg.yank --sender` |
| `ya` | `msg.yank --address` |
| `yi` | `msg.yank --message-id` |

#### Hints

| Key | Command |
| --- | --- |
| `;;` | `cmdline.open 'hint '` |
| `;f` | `hint --focus` |
| `;c` | `hint` |
| `;y` | `hint --yank` |

#### Next

| Key | Command |
| --- | --- |
| `]t` | `step.thread_root next` |
| `]u` | `step.unread --next` |
| `]U` | `step.unread --next --all-folders` |
| `]s` | `step.starred next` |
| `]a` | `step.attachment next` |

#### Previous

| Key | Command |
| --- | --- |
| `[t` | `step.thread_root previous` |
| `[u` | `step.unread --previous` |
| `[U` | `step.unread --previous --all-folders` |
| `[s` | `step.starred previous` |
| `[a` | `step.attachment previous` |

#### Delete

| Key | Command |
| --- | --- |
| `dd` | `msg.delete` |

### Message

A message in a tab or the message pane.

#### Single keys

| Key | Command |
| --- | --- |
| `j` | `message.scroll_down` |
| `k` | `message.scroll_up` |
| `<C-d>` | `message.half_page_down` |
| `<C-u>` | `message.half_page_up` |
| `<C-f>` | `message.page_down` |
| `<C-b>` | `message.page_up` |
| `h` | `message.scroll_left` |
| `l` | `message.scroll_right` |
| `G` | `message.bottom` |
| `/` | `cmdline.open 'find '` |
| `n` | `message.find_next` |
| `N` | `message.find_prev` |
| `f` | `hint.pick` |
| `a` | `msg.archive` |
| `r` | `msg.reply` |
| `R` | `msg.reply --all` |
| `c` | `msg.new` |
| `<C-l>` | `msg.open` |
| `J` | `tab.next` |
| `K` | `tab.prev` |
| `<A-j>` | `tab.next` |
| `<A-k>` | `tab.prev` |
| `q` | `tab.close` |
| `<A-q>` | `tab.close` |
| `:` | `cmdline.open` |
| `T` | `cmdline.open 'tab '` |
| `u` | `undo` |
| `H` | `pane.left` |
| `<A-h>` | `pane.left` |
| `L` | `pane.right` |
| `<A-l>` | `pane.right` |

#### Go

| Key | Command |
| --- | --- |
| `gg` | `message.top` |
| `g?` | `help.open` |
| `gF` | `msg.forward` |
| `gu` | `msg.unsubscribe` |
| `ga` | `msg.save_attachments` |
| `gC` | `thread.open_conversation` |
| `gf` | `pane.focus folders` |
| `ge` | `pane.focus threads` |
| `gm` | `pane.focus message` |

#### Quick reply

| Key | Command |
| --- | --- |
| `gr1` | `msg.reply_with 1` |
| `gr2` | `msg.reply_with 2` |
| `gr3` | `msg.reply_with 3` |
| `gr4` | `msg.reply_with 4` |
| `gr5` | `msg.reply_with 5` |
| `gr6` | `msg.reply_with 6` |
| `gr7` | `msg.reply_with 7` |
| `gr8` | `msg.reply_with 8` |
| `gr9` | `msg.reply_with 9` |

#### Pages

| Key | Command |
| --- | --- |
| `gpa` | `app.open_page addons` |
| `gpt` | `app.open_page themes` |
| `gpc` | `app.open_page config` |

#### Message

| Key | Command |
| --- | --- |
| `mr` | `msg.read --read` |
| `mu` | `msg.read --unread` |
| `ms` | `msg.flag` |
| `mj` | `msg.junk` |
| `mt` | `cmdline.open 'tag '` |
| `mm` | `cmdline.open 'move '` |
| `mc` | `cmdline.open 'copy '` |

#### Snooze

| Key | Command |
| --- | --- |
| `mzl` | `msg.snooze later_today` |
| `mzt` | `msg.snooze tomorrow` |
| `mzw` | `msg.snooze weekend` |
| `mzm` | `msg.snooze monday` |

#### Remind

| Key | Command |
| --- | --- |
| `mfd` | `msg.remind one_day` |
| `mft` | `msg.remind three_days` |
| `mfw` | `msg.remind one_week` |
| `mfc` | `msg.remind_cancel` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help.open` |
| `,s` | `options` |
| `,?` | `help.open` |

#### Tabs

| Key | Command |
| --- | --- |
| `tn` | `tab.next` |
| `tp` | `tab.prev` |
| `t0` | `tab 1` |
| `t$` | `tab.goto -1` |
| `tl` | `tab.alternate` |
| `tm` | `cmdline.open 'tab.move '` |
| `tM` | `cmdline.open tab.move --offset=` |
| `tT` | `cmdline.open 'tab '` |

#### Panes

| Key | Command |
| --- | --- |
| `wh` | `pane.left` |
| `wl` | `pane.right` |

#### Zoom and scroll

| Key | Command |
| --- | --- |
| `zi` | `zoom.by 0.1` |
| `z+` | `zoom.by 0.1` |
| `zo` | `zoom.by -0.1` |
| `z-` | `zoom.by -0.1` |
| `zm` | `zoom.by 0.5` |
| `zr` | `zoom.by -0.5` |
| `z=` | `zoom 1` |
| `zI` | `zoom 3` |
| `zO` | `zoom 0.3` |

#### Copy

| Key | Command |
| --- | --- |
| `yy` | `msg.yank` |
| `ys` | `msg.yank --subject` |
| `yf` | `msg.yank --sender` |
| `ya` | `msg.yank --address` |
| `yi` | `msg.yank --message-id` |

#### Hints

| Key | Command |
| --- | --- |
| `;f` | `hint.pick --focus` |
| `;c` | `hint.pick` |
| `;y` | `hint.pick --yank` |

#### Delete

| Key | Command |
| --- | --- |
| `dd` | `msg.delete` |

### Message window

A message in a window of its own (message mode), in the body and in the header. It has no tab, pane or command line keys.

#### Single keys

| Key | Command |
| --- | --- |
| `J` | `step.message --next --unread=false` |
| `K` | `step.message --previous --unread=false` |
| `j` | `message.scroll_down` |
| `k` | `message.scroll_up` |
| `<C-d>` | `message.half_page_down` |
| `<C-u>` | `message.half_page_up` |
| `<C-f>` | `message.page_down` |
| `<C-b>` | `message.page_up` |
| `h` | `message.scroll_left` |
| `l` | `message.scroll_right` |
| `G` | `message.bottom` |
| `/` | `cmdline.open 'find '` |
| `n` | `message.find_next` |
| `N` | `message.find_prev` |
| `f` | `hint.pick` |
| `a` | `msg.archive` |
| `r` | `msg.reply` |
| `R` | `msg.reply --all` |
| `c` | `msg.new` |
| `<C-l>` | `msg.open` |
| `q` | `tab.close` |
| `<A-q>` | `tab.close` |
| `:` | `cmdline.open` |
| `u` | `undo` |

#### Go

| Key | Command |
| --- | --- |
| `gg` | `message.top` |
| `g?` | `help.open` |
| `gF` | `msg.forward` |
| `gu` | `msg.unsubscribe` |
| `ga` | `msg.save_attachments` |
| `gC` | `thread.open_conversation` |

#### Quick reply

| Key | Command |
| --- | --- |
| `gr1` | `msg.reply_with 1` |
| `gr2` | `msg.reply_with 2` |
| `gr3` | `msg.reply_with 3` |
| `gr4` | `msg.reply_with 4` |
| `gr5` | `msg.reply_with 5` |
| `gr6` | `msg.reply_with 6` |
| `gr7` | `msg.reply_with 7` |
| `gr8` | `msg.reply_with 8` |
| `gr9` | `msg.reply_with 9` |

#### Pages

| Key | Command |
| --- | --- |
| `gpa` | `app.open_page addons` |
| `gpt` | `app.open_page themes` |
| `gpc` | `app.open_page config` |

#### Message

| Key | Command |
| --- | --- |
| `mr` | `msg.read --read` |
| `mu` | `msg.read --unread` |
| `ms` | `msg.flag` |
| `mj` | `msg.junk` |
| `mt` | `cmdline.open 'tag '` |
| `mm` | `cmdline.open 'move '` |
| `mc` | `cmdline.open 'copy '` |

#### Snooze

| Key | Command |
| --- | --- |
| `mzl` | `msg.snooze later_today` |
| `mzt` | `msg.snooze tomorrow` |
| `mzw` | `msg.snooze weekend` |
| `mzm` | `msg.snooze monday` |

#### Remind

| Key | Command |
| --- | --- |
| `mfd` | `msg.remind one_day` |
| `mft` | `msg.remind three_days` |
| `mfw` | `msg.remind one_week` |
| `mfc` | `msg.remind_cancel` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help.open` |
| `,s` | `options` |
| `,?` | `help.open` |

#### Zoom and scroll

| Key | Command |
| --- | --- |
| `zi` | `zoom.by 0.1` |
| `z+` | `zoom.by 0.1` |
| `zo` | `zoom.by -0.1` |
| `z-` | `zoom.by -0.1` |
| `zm` | `zoom.by 0.5` |
| `zr` | `zoom.by -0.5` |
| `z=` | `zoom 1` |
| `zI` | `zoom 3` |
| `zO` | `zoom 0.3` |

#### Copy

| Key | Command |
| --- | --- |
| `yy` | `msg.yank` |
| `ys` | `msg.yank --subject` |
| `yf` | `msg.yank --sender` |
| `ya` | `msg.yank --address` |
| `yi` | `msg.yank --message-id` |

#### Hints

| Key | Command |
| --- | --- |
| `;f` | `hint.pick --focus` |
| `;c` | `hint.pick` |
| `;y` | `hint.pick --yank` |

#### Next

| Key | Command |
| --- | --- |
| `]u` | `step.message --next --unread` |

#### Previous

| Key | Command |
| --- | --- |
| `[u` | `step.message --previous --unread` |

#### Delete

| Key | Command |
| --- | --- |
| `dd` | `msg.delete` |

### Compose window

The body of a message being written, in normal mode (Escape enters it, `i` returns to typing). Ctrl+E edits in either mode. A key left out is not a key there, and no key closes the window. A binding on `i`, on Escape or on a chord has no effect.

#### Single keys

| Key | Command |
| --- | --- |
| `e` | `edit` |
| `s` | `save` |
| `?` | `help.open` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help.open` |

#### Zoom and scroll

| Key | Command |
| --- | --- |
| `zi` | `zoom.by 0.1` |
| `z+` | `zoom.by 0.1` |
| `zo` | `zoom.by -0.1` |
| `z-` | `zoom.by -0.1` |
| `zm` | `zoom.by 0.5` |
| `zr` | `zoom.by -0.5` |
| `z=` | `zoom 1` |
| `zI` | `zoom 3` |
| `zO` | `zoom 0.3` |

### Own pages

The options page and the help page.

#### Single keys

| Key | Command |
| --- | --- |
| `j` | `message.scroll_down` |
| `k` | `message.scroll_up` |
| `<C-d>` | `message.half_page_down` |
| `<C-u>` | `message.half_page_up` |
| `<C-f>` | `message.page_down` |
| `<C-b>` | `message.page_up` |
| `h` | `message.scroll_left` |
| `l` | `message.scroll_right` |
| `G` | `message.bottom` |
| `/` | `cmdline.open 'find '` |
| `n` | `message.find_next` |
| `N` | `message.find_prev` |
| `f` | `hint.pick` |
| `c` | `msg.new` |
| `J` | `tab.next` |
| `K` | `tab.prev` |
| `<A-j>` | `tab.next` |
| `<A-k>` | `tab.prev` |
| `q` | `tab.close` |
| `<A-q>` | `tab.close` |
| `:` | `cmdline.open` |
| `T` | `cmdline.open 'tab '` |

#### Go

| Key | Command |
| --- | --- |
| `gg` | `message.top` |
| `g?` | `help.open` |

#### Pages

| Key | Command |
| --- | --- |
| `gpa` | `app.open_page addons` |
| `gpt` | `app.open_page themes` |
| `gpc` | `app.open_page config` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help.open` |
| `,s` | `options` |
| `,?` | `help.open` |

#### Tabs

| Key | Command |
| --- | --- |
| `tn` | `tab.next` |
| `tp` | `tab.prev` |
| `t0` | `tab 1` |
| `t$` | `tab.goto -1` |
| `tl` | `tab.alternate` |
| `tm` | `cmdline.open 'tab.move '` |
| `tM` | `cmdline.open tab.move --offset=` |
| `tT` | `cmdline.open 'tab '` |

#### Zoom and scroll

| Key | Command |
| --- | --- |
| `zi` | `zoom.by 0.1` |
| `z+` | `zoom.by 0.1` |
| `zo` | `zoom.by -0.1` |
| `z-` | `zoom.by -0.1` |
| `zm` | `zoom.by 0.5` |
| `zr` | `zoom.by -0.5` |
| `z=` | `zoom 1` |
| `zI` | `zoom 3` |
| `zO` | `zoom 0.3` |

#### Hints

| Key | Command |
| --- | --- |
| `;f` | `hint.pick --focus` |
| `;c` | `hint.pick` |
| `;y` | `hint.pick --yank` |

### Other tabs

Calendar, tasks, chat, the address book, settings and `about:` pages.

#### Single keys

| Key | Command |
| --- | --- |
| `c` | `msg.new` |
| `J` | `tab.next` |
| `K` | `tab.prev` |
| `<A-j>` | `tab.next` |
| `<A-k>` | `tab.prev` |
| `q` | `tab.close` |
| `<A-q>` | `tab.close` |
| `:` | `cmdline.open` |
| `T` | `cmdline.open 'tab '` |
| `f` | `hint` |
| `j` | `page.scroll_down` |
| `k` | `page.scroll_up` |
| `<C-d>` | `page.half_down` |
| `<C-u>` | `page.half_up` |
| `<C-f>` | `page.page_down` |
| `<C-b>` | `page.page_up` |
| `h` | `page.scroll_left` |
| `l` | `page.scroll_right` |
| `G` | `page.bottom` |
| `i` | `mode.insert` |

#### Go

| Key | Command |
| --- | --- |
| `g?` | `help.whichkey` |
| `gg` | `page.top` |

#### Pages

| Key | Command |
| --- | --- |
| `gpa` | `app.open_page addons` |
| `gpt` | `app.open_page themes` |
| `gpc` | `app.open_page config` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help.open` |
| `,s` | `options` |
| `,?` | `help.whichkey` |

#### Tabs

| Key | Command |
| --- | --- |
| `tn` | `tab.next` |
| `tp` | `tab.prev` |
| `t0` | `tab 1` |
| `t$` | `tab.goto -1` |
| `tl` | `tab.alternate` |
| `tm` | `cmdline.open 'tab.move '` |
| `tM` | `cmdline.open tab.move --offset=` |
| `tT` | `cmdline.open 'tab '` |

#### Zoom and scroll

| Key | Command |
| --- | --- |
| `zi` | `zoom.by 0.1` |
| `z+` | `zoom.by 0.1` |
| `zo` | `zoom.by -0.1` |
| `z-` | `zoom.by -0.1` |
| `zm` | `zoom.by 0.5` |
| `zr` | `zoom.by -0.5` |
| `z=` | `zoom 1` |
| `zI` | `zoom 3` |
| `zO` | `zoom 0.3` |

#### Hints

| Key | Command |
| --- | --- |
| `;;` | `cmdline.open 'hint '` |
| `;f` | `hint --focus` |
| `;c` | `hint` |
| `;y` | `hint --yank` |

### Text fields

A text field in a page tab or in the mail tab (the quick filter, the search box). Plain keys are text there. Alt+j and Alt+k also work in insert mode.

#### Single keys

| Key | Command |
| --- | --- |
| `<A-j>` | `tab.next` |
| `<A-k>` | `tab.prev` |
| `<Escape>` | `mode.escape` |
| `<C-[>` | `mode.escape` |

<!-- END generated -->
