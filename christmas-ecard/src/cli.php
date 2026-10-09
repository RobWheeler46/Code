<?php
// Usage: php src/cli.php queue | purge | admin <email> [role,role]   (roles default to all)
require __DIR__ . "/app.php";
$c = $argv[1] ?? "";
if ($c === "queue") { set_setting("last_queue", (string)time()); echo process_queue() . " sent\n"; }
elseif ($c === "purge") echo purge_old() . " purged\n";
elseif ($c === "admin" && isset($argv[2])) echo q("update users set is_admin=1, roles=? where email=?", [$argv[3] ?? implode(",", array_keys(ROLES)), strtolower($argv[2])])->rowCount() ? "ok\n" : "no such user\n";
else echo "queue | purge | admin <email> [roles]\n";
