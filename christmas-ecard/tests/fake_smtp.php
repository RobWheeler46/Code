<?php
// A tiny pretend mail server for tests/smtp_test.php. Run: php tests/fake_smtp.php PORT LOGFILE
[, $port, $log] = $argv; $srv = stream_socket_server("tcp://127.0.0.1:$port", $en, $es); if (!$srv) exit(1);
while ($c = @stream_socket_accept($srv, 3600)) {
    $w = fn($s) => fwrite($c, $s . "\r\n"); $rec = ['cmds' => [], 'data' => '', 'user' => null, 'pass' => null]; $w('220 fake ESMTP'); $state = ''; $rcpt = '';
    while (($l = fgets($c)) !== false) {
        $l = rtrim($l, "\r\n");
        if ($state === 'data') {
            if ($l === '.') {
                $state = '';
                if (str_contains($rcpt, 'afterdata')) $w('554 5.7.1 rejected after data');
                elseif (str_contains($rcpt, 'silent')) break;
                else $w('250 2.0.0 queued');
                file_put_contents($log, json_encode($rec) . "\n", FILE_APPEND);
            } else $rec['data'] .= (str_starts_with($l, '..') ? substr($l, 1) : $l) . "\n";
            continue;
        }
        if ($state === 'user') { $rec['user'] = base64_decode($l); $state = 'pass'; $w('334 UGFzc3dvcmQ6'); continue; }
        if ($state === 'pass') { $rec['pass'] = base64_decode($l); $state = ''; $w($rec['pass'] === 'bad' ? '535 5.7.8 authentication failed' : '235 ok'); continue; }
        $rec['cmds'][] = strtok($l, ' ');
        if (str_starts_with($l, 'EHLO')) $w("250-fake\r\n250-AUTH LOGIN\r\n250 8BITMIME");
        elseif ($l === 'AUTH LOGIN') { $state = 'user'; $w('334 VXNlcm5hbWU6'); }
        elseif (str_starts_with($l, 'MAIL FROM')) { $rec['from'] = $l; $w('250 ok'); }
        elseif (str_starts_with($l, 'RCPT TO')) { $rcpt = $l; $rec['rcpt'] = $l; if (str_contains($l, 'perm')) $w('550 5.1.1 no such user'); elseif (str_contains($l, 'temp')) $w('451 4.3.0 try later'); else $w('250 ok'); }
        elseif ($l === 'DATA') { $state = 'data'; $w('354 go'); }
        elseif ($l === 'QUIT') { $w('221 bye'); break; }
        else $w('250 ok');
    }
    fclose($c);
}
