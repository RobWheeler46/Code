<?php
// Usage: php src/cli.php queue | purge | admin <email>
require __DIR__ . "/app.php";
$c = $argv[1] ?? "";
if ($c === "queue") echo process_queue() . " sent\n";
elseif ($c === "purge") echo purge_old() . " purged\n";
elseif ($c === "admin" && isset($argv[2])) echo q("update users set is_admin=1 where email=?", [strtolower($argv[2])])->rowCount() ? "ok\n" : "no such user\n";
else echo "queue | purge | admin <email>\n";
