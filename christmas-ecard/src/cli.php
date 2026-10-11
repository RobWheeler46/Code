<?php
// Usage: php src/cli.php queue | alerts | alerts-daily | purge | remind | digest | backup | restore <file.zip> [dir] | reset-demo | admin <email> [role,role]
require __DIR__ . "/app.php";
$c = $argv[1] ?? "";
if ($c === "queue") { set_setting("last_queue", (string)time()); echo process_queue() . " sent\n"; }
elseif ($c === "alerts") echo alerts_tick() . " alert emails\n";
elseif ($c === "alerts-daily") echo alerts_daily() . " summaries\n";
elseif ($c === "backup") { // set BACKUP_KEY, and BACKUP_COPY_DIR or BACKUP_EMAIL, so a copy leaves this server
    $r = backup_run();
    echo ($r['zip'] ? "encrypted backup: " . $r['zip'] : "local snapshot: " . $r['plain']) . "\n";
    foreach ($r['offsite'] as $o) echo "off-server copy: $o\n";
    foreach ($r['warnings'] as $w) echo "WARNING: $w\n";
    exit($r['offsite'] ? 0 : 2);
}
elseif ($c === "restore") { // rehearsal: unpacks beside the live data, never over it
    $zip = $argv[2] ?? ""; $dir = $argv[3] ?? (ROOT . "/data/restore-" . date("Ymd-His"));
    if ($zip === "" || env("BACKUP_KEY") === "") { echo "Usage: BACKUP_KEY=... php src/cli.php restore <backup.zip> [target-dir]\n"; exit(1); }
    $r = backup_restore($zip, env("BACKUP_KEY"), $dir);
    if (!$r["ok"]) { echo "RESTORE FAILED: " . ($r["error"] ?? $r["integrity"] ?? "unknown") . "\n"; exit(1); }
    echo "restore ok into $dir\nintegrity: {$r['integrity']}\nrows: " . json_encode($r["counts"]) . "\nartwork files: {$r['art']}\n";
}
elseif ($c === "library-rollback") { echo implode("
", library_rollback()) . "
Now set LIBRARY_MIGRATE=off in .env so the tables are not recreated on the next request.
"; }
elseif ($c === "reset-demo") { // staging only: clears cards, donations and non-admin accounts
    if (env("APP_ENV", "development") === "production") { echo "Refused: this is production.\n"; exit(1); }
    foreach (["recipients", "sends", "donations", "reports", "optouts", "contacts", "groups", "contact_groups", "alerts"] as $t) db()->exec("delete from $t");
    db()->exec("delete from users where is_admin=0"); echo "Demo data cleared.\n";
}
elseif ($c === "digest") echo send_digests() . " digests\n";
elseif ($c === "remind") echo send_reminders() . " reminders\n";
elseif ($c === "purge") echo purge_old() . " purged\n";
elseif ($c === "admin" && isset($argv[2])) echo q("update users set is_admin=1, roles=? where email=?", [$argv[3] ?? implode(",", array_diff(array_keys(ROLES), array_keys(TG_ROLES), array_keys(SL_ROLES))), strtolower($argv[2])])->rowCount() ? "ok\n" : "no such user\n";
else echo "queue | alerts | alerts-daily | purge | remind | digest | backup | restore <backup.zip> [dir] | reset-demo | admin <email> [roles]\n";
