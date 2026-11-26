# Keymap

The default keys of DesertBird, generated from the command table in `src/background/commands/`. Do not edit between the markers. Run `npm run docs:gen` after a change to a binding. `npm run check` fails when the tables are stale.

Each tab kind has its own table, because a tab gets only the keys whose commands it can serve. A single key that is missing from a table reaches Thunderbird. In a message or own-page tab, a missing mail sequence such as `m R` is consumed and does nothing, so it never runs its tail as a key of its own. Tables split by which-key group. A key has the group of its longest named prefix, so `g a` is under Go and `j` is under Single keys. A key you set in the options page or in the keys editor goes on top of these defaults.

A command shows in the long form the command line takes. A note "(prompts)" means the binding sets a `prompt` for a param, so the command line asks for it.

<!-- BEGIN generated -->

bound: 533 (Mail tab 169, Message 112, Message window 94, Compose window 24, Own pages 64, Other tabs 62, Text fields 4, Open menus 4)

### Mail tab

The thread list and the folder pane.

#### Single keys

| Key | Command |
| --- | --- |
| `j` | `motion.down` |
| `k` | `motion.up` |
| `G` | `motion.bottom` |
| `.` | `repeat` |
| `v` | `visual.toggle` |
| `<Space>` | `select.toggle` |
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
| `O` | `cmdline.open 'open --tab '` |
| `T` | `cmdline.open 'tab '` |
| `<C-o>` | `jump.back` |
| `<C-i>` | `jump.forward` |
| `M` | `mark` |
| `'` | `mark.jump` |
| `h` | `motion.left` |
| `l` | `motion.right` |
| `<C-d>` | `view.half_page next` |
| `<C-u>` | `view.half_page previous` |
| `<A-?>` | `help.whichkey` |
| `u` | `undo` |
| `e` | `fetch` |
| `H` | `pane.left` |
| `<A-h>` | `pane.left` |
| `L` | `pane.right` |
| `<A-l>` | `pane.right` |
| `/` | `search.open forward` |
| `?` | `search.open backward` |
| `n` | `search.next` |
| `N` | `search.prev` |
| `f` | `hint` |
| `i` | `mode.insert` |

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
| `g?` | `help` |
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
| `gpm` | `app.open_page mail` |
| `gpb` | `app.open_page addressbook` |
| `gpl` | `app.open_page calendar` |
| `gpk` | `app.open_page tasks` |
| `gph` | `app.open_page chat` |
| `gps` | `app.open_page settings` |
| `gpn` | `app.open_page accountsettings` |
| `gpd` | `app.open_page downloads` |
| `gpy` | `app.open_page activity` |
| `gpi` | `app.open_page support` |

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

#### Filter by

| Key | Command |
| --- | --- |
| `bu` | `filter --unread` |
| `br` | `filter --all` |
| `bs` | `filter --toggle-starred` |
| `ba` | `filter --attachment` |
| `bf` | `cmdline.open 'filter '` |
| `bt` | `cmdline.open filter --tag --tag=` |

#### Filter by message

| Key | Command |
| --- | --- |
| `bmf` | `filter-by from` |
| `bms` | `filter-by subject` |
| `bmr` | `filter-by recipient` |
| `bmt` | `filter-by tag` |
| `bml` | `filter-by list` |
| `bmd` | `filter-by date` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help` |
| `,s` | `options` |
| `,?` | `help.whichkey` |
| `,m` | `context.menu` |

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
| `<A-?>` | `help` |
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
| `e` | `fetch` |
| `H` | `pane.left` |
| `<A-h>` | `pane.left` |
| `L` | `pane.right` |
| `<A-l>` | `pane.right` |
| `i` | `mode.insert` |

#### Go

| Key | Command |
| --- | --- |
| `gg` | `message.top` |
| `gF` | `msg.forward` |
| `gu` | `msg.unsubscribe` |
| `ga` | `msg.save_attachments` |
| `g?` | `help` |
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
| `gpm` | `app.open_page mail` |
| `gpb` | `app.open_page addressbook` |
| `gpl` | `app.open_page calendar` |
| `gpk` | `app.open_page tasks` |
| `gph` | `app.open_page chat` |
| `gps` | `app.open_page settings` |
| `gpn` | `app.open_page accountsettings` |
| `gpd` | `app.open_page downloads` |
| `gpy` | `app.open_page activity` |
| `gpi` | `app.open_page support` |

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
| `,h` | `help` |
| `,s` | `options` |
| `,?` | `help` |
| `,m` | `context.menu` |

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
| `<A-?>` | `help` |
| `a` | `msg.archive` |
| `r` | `msg.reply` |
| `R` | `msg.reply --all` |
| `c` | `msg.new` |
| `<C-l>` | `msg.open` |
| `q` | `tab.close` |
| `<A-q>` | `tab.close` |
| `:` | `cmdline.open` |
| `u` | `undo` |
| `e` | `fetch` |
| `i` | `mode.insert` |

#### Go

| Key | Command |
| --- | --- |
| `gg` | `message.top` |
| `gF` | `msg.forward` |
| `gu` | `msg.unsubscribe` |
| `ga` | `msg.save_attachments` |
| `g?` | `help` |
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
| `gpm` | `app.open_page mail` |
| `gpb` | `app.open_page addressbook` |
| `gpl` | `app.open_page calendar` |
| `gpk` | `app.open_page tasks` |
| `gph` | `app.open_page chat` |
| `gps` | `app.open_page settings` |
| `gpn` | `app.open_page accountsettings` |
| `gpd` | `app.open_page downloads` |
| `gpy` | `app.open_page activity` |
| `gpi` | `app.open_page support` |

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
| `,h` | `help` |
| `,s` | `options` |
| `,?` | `help` |
| `,m` | `context.menu` |

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

A message being written, in normal mode: the body and the To, Cc, Bcc and Subject fields share one mode (Escape enters it, `i` returns to typing). Ctrl+E edits in either mode. A key left out is not a key there. `q` closes through Thunderbird, which asks to save a changed draft. `g S` sends only while the `compose_send` setting is on. A binding on `i` or on Escape has no effect.

#### Single keys

| Key | Command |
| --- | --- |
| `e` | `edit` |
| `s` | `save` |
| `?` | `help` |
| `<A-?>` | `help.whichkey` |
| `q` | `compose.close` |

#### Go

| Key | Command |
| --- | --- |
| `g?` | `help` |
| `gt` | `compose.focus to` |
| `gc` | `compose.focus cc` |
| `gb` | `compose.focus bcc` |
| `gs` | `compose.focus subject` |
| `gm` | `compose.focus body` |
| `gS` | `compose.send` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help` |
| `,?` | `help.whichkey` |
| `,m` | `context.menu` |

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
| `<A-?>` | `help` |
| `c` | `msg.new` |
| `J` | `tab.next` |
| `K` | `tab.prev` |
| `<A-j>` | `tab.next` |
| `<A-k>` | `tab.prev` |
| `q` | `tab.close` |
| `<A-q>` | `tab.close` |
| `:` | `cmdline.open` |
| `T` | `cmdline.open 'tab '` |
| `e` | `fetch` |
| `i` | `mode.insert` |

#### Go

| Key | Command |
| --- | --- |
| `gg` | `message.top` |
| `g?` | `help` |

#### Pages

| Key | Command |
| --- | --- |
| `gpa` | `app.open_page addons` |
| `gpt` | `app.open_page themes` |
| `gpc` | `app.open_page config` |
| `gpm` | `app.open_page mail` |
| `gpb` | `app.open_page addressbook` |
| `gpl` | `app.open_page calendar` |
| `gpk` | `app.open_page tasks` |
| `gph` | `app.open_page chat` |
| `gps` | `app.open_page settings` |
| `gpn` | `app.open_page accountsettings` |
| `gpd` | `app.open_page downloads` |
| `gpy` | `app.open_page activity` |
| `gpi` | `app.open_page support` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help` |
| `,s` | `options` |
| `,?` | `help` |
| `,m` | `context.menu` |

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
| `<A-?>` | `help.whichkey` |
| `e` | `fetch` |
| `f` | `hint` |
| `i` | `mode.insert` |
| `j` | `page.scroll_down` |
| `k` | `page.scroll_up` |
| `<C-d>` | `page.half_down` |
| `<C-u>` | `page.half_up` |
| `<C-f>` | `page.page_down` |
| `<C-b>` | `page.page_up` |
| `h` | `page.scroll_left` |
| `l` | `page.scroll_right` |
| `G` | `page.bottom` |

#### Go

| Key | Command |
| --- | --- |
| `g?` | `help` |
| `gg` | `page.top` |

#### Pages

| Key | Command |
| --- | --- |
| `gpa` | `app.open_page addons` |
| `gpt` | `app.open_page themes` |
| `gpc` | `app.open_page config` |
| `gpm` | `app.open_page mail` |
| `gpb` | `app.open_page addressbook` |
| `gpl` | `app.open_page calendar` |
| `gpk` | `app.open_page tasks` |
| `gph` | `app.open_page chat` |
| `gps` | `app.open_page settings` |
| `gpn` | `app.open_page accountsettings` |
| `gpd` | `app.open_page downloads` |
| `gpy` | `app.open_page activity` |
| `gpi` | `app.open_page support` |

#### DesertBird

| Key | Command |
| --- | --- |
| `,h` | `help` |
| `,s` | `options` |
| `,?` | `help.whichkey` |
| `,m` | `context.menu` |

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

### Open menus

A native menu or popup is open (a context menu, a menu bar menu, a dropdown, the app menu opened by the keyboard) in any window, dialogs included. These keys move the selection and are rebindable in the Menu keys section of the options page, which is apart from the key bindings. A menu key must be one typed character. The access keys of the menu lose the keys that move it.

#### Single keys

| Key | Command |
| --- | --- |
| `j` | `menu.down` |
| `k` | `menu.up` |
| `h` | `menu.left` |
| `l` | `menu.right` |

<!-- END generated -->
