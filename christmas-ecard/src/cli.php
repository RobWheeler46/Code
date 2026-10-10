<?php
// Usage: php src/cli.php queue | purge | digest | backup | admin <email> [role,role]   (roles default to all)
require __DIR__ . "/app.php";
$c = $argv[1] ?? "";
if ($c === "queue") { set_setting("last_queue", (string)time()); echo process_queue() . " sent\n"; }
elseif ($c === "backup") { $d = ROOT . "/data/backups"; @mkdir($d, 0775, true); $f = $d . "/ecard-" . date("Ymd-His") . ".sqlite"; db()->exec("vacuum into '" . str_replace("'", "", $f) . "'"); foreach (glob("$d/*.sqlite") as $o) if (filemtime($o) < time() - 30 * 86400) unlink($o); set_setting("last_backup", (string)time()); echo "backup ok: $f\n"; }
elseif ($c === "digest") echo send_digests() . " digests\n";
elseif ($c === "purge") echo purge_old() . " purged\n";
elseif ($c === "admin" && isset($argv[2])) echo q("update users set is_admin=1, roles=? where email=?", [$argv[3] ?? implode(",", array_keys(ROLES)), strtolower($argv[2])])->rowCount() ? "ok\n" : "no such user\n";
else echo "queue | purge | admin <email> [roles]\n";
