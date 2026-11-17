# Config

The settings and the user's key bindings, kept in `storage.local`. The background page and the options page each build a store from `store.ts`.

## Files

- `store.ts`: reads and writes three keys. `desertbird_config_version` holds the data version, `desertbird_settings` holds only the settings the user changed, `desertbird_user_keymap` holds the user's normal-mode bindings. The memory copy refills on read and drops on `storage.onChanged`. A read that began before a change never fills the copy. A write leaves the version key alone: the next read stamps it, after any migration.
- `settings.ts`: the settings DesertBird stores, a subset of the vendored table plus the settings only DesertBird has (`message_scroll_step_px`, the step of `j` and `k` in a message, default 40). `Settings` and `SETTING_DEFAULTS` there are the full type and defaults. Each has a kind that checks its value. `notify_new_mail` (default `false`) switches the new-mail notifications, and `notify.toggle` flips it. Stored values that are unknown or mistyped are ignored and reported.
- `migrations.ts`: `MIGRATIONS` is empty. A change to the stored shape adds one step, which turns version `n` into `n + 1`. Data with a newer version than the add-on knows is read as it is and its version is not lowered.
- `keymap.ts`: the default bindings with the user's on top (`effective_keymap`), compiled through the vendored compiler. A `null` binding removes a default key.

## Flow

`main.ts` hashes the effective keymap, compiles it, stores the tree and calls `keys.install`. A write to the user keymap key drops the copy and installs the new tree, with no restart. The matcher reads no setting, so a settings change does not reinstall anything. The settings are stored and read from the table for the consumers that join later.

No native host reads a config file yet, and there is no reload command.
