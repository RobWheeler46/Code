<?php
// Zips ./dist into 7thportal-php-deploy.zip using forward-slash paths
// (the ZIP spec's actual separator) - PowerShell's Compress-Archive stores
// backslashes instead, which some extractors (including cPanel's own) don't
// reliably unpack into real subdirectories. Run scripts/build-deploy.php first.

$root = dirname(__DIR__);
$distDir = $root . '/dist';
$zipPath = $root . '/7thportal-php-deploy.zip';

if (!is_dir($distDir)) {
    fwrite(STDERR, "dist/ not found - run scripts/build-deploy.php first.\n");
    exit(1);
}
if (file_exists($zipPath)) unlink($zipPath);

$zip = new ZipArchive();
if ($zip->open($zipPath, ZipArchive::CREATE) !== true) {
    fwrite(STDERR, "Could not create $zipPath\n");
    exit(1);
}

function addTree(ZipArchive $zip, string $dir, string $base): void
{
    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($items as $item) {
        $relative = str_replace('\\', '/', substr($item->getPathname(), strlen($dir) + 1));
        $localName = $base === '' ? $relative : $base . '/' . $relative;
        if ($item->isDir()) {
            $zip->addEmptyDir($localName);
        } else {
            $zip->addFile($item->getPathname(), $localName);
        }
    }
}

addTree($zip, $distDir, '');
$zip->close();

echo "Created $zipPath (" . round(filesize($zipPath) / 1024, 1) . " KB)\n";
