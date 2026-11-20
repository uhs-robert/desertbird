# Keymap

The default keys of DesertBird, generated from the command table in `src/background/commands/`. Do not edit between the markers. Run `npm run docs:gen` after a change to a binding. `npm run check` fails when the tables are stale.

Each tab kind has its own table, because a tab gets only the keys whose commands it can serve. A single key that is missing from a table reaches Thunderbird. In a message or own-page tab, a missing mail sequence such as `m R` is consumed and does nothing, so it never runs its tail as a key of its own. Tables split by which-key group. A key has the group of its longest named prefix, so `g a` is under Go and `j` is under Single keys. A key you set in the options page or in the keys editor goes on top of these defaults.

A command shows in the long form the command line takes. A note "(prompts)" means the binding sets a `prompt` for a param, so the command line asks for it.

<!-- BEGIN generated -->

bound: 305 (Mail tab 140, Message 88, Own pages 42, Other tabs 35)

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
| `H` | `folder.collapse` |
| `<C-o>` | `jump.back` |
| `<C-i>` | `jump.forward` |
| `M` | `mark.set` |
| `'` | `mark.jump` |
| `h` | `motion.left` |
| `l` | `motion.right` |
| `<C-d>` | `view.half_page next` |
| `<C-u>` | `view.half_page previous` |
| `u` | `undo` |
| `<A-h>` | `pane.focus threads` |
| `L` | `pane.focus threads` |
| `<A-l>` | `pane.focus message` |
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
| `tT` | `cmdline.open 'tab '` |

#### Panes

| Key | Command |
| --- | --- |
| `wm` | `pane.toggle message` |
| `wf` | `pane.toggle folder` |

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

A message in a tab, a window or the message pane.

#### Single keys

| Key | Command |
| --- | --- |
| `j` | `message.scroll_down` |
| `k` | `message.scroll_up` |
| `<C-d>` | `message.half_page_down` |
| `<C-u>` | `message.half_page_up` |
| `G` | `message.bottom` |
| `/` | `cmdline.open 'find '` |
| `n` | `message.find_next` |
| `N` | `message.find_prev` |
| `f` | `hint.pick` |
| `H` | `pane.focus folders` |
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
| `<A-h>` | `pane.focus threads` |
| `L` | `pane.focus threads` |
| `<A-l>` | `pane.focus message` |

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

### Own pages

The options page and the help page.

#### Single keys

| Key | Command |
| --- | --- |
| `j` | `message.scroll_down` |
| `k` | `message.scroll_up` |
| `<C-d>` | `message.half_page_down` |
| `<C-u>` | `message.half_page_up` |
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
| `j` | `page.scroll_down` |
| `k` | `page.scroll_up` |
| `<C-d>` | `page.half_down` |
| `<C-u>` | `page.half_up` |
| `G` | `page.bottom` |

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

<!-- END generated -->
