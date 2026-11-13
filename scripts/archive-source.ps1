param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$destinationPath=[System.IO.Path]::GetFullPath($Destination)
if(Test-Path -LiteralPath $destinationPath){throw 'Archive already exists. Increment the release version.'}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[System.IO.Compression.ZipFile]::Open($destinationPath,[System.IO.Compression.ZipArchiveMode]::Create)
try {
  $files=@(Get-Item -LiteralPath (Join-Path $projectRoot 'README.md'),(Join-Path $projectRoot '.gitignore'))
  $files+=Get-ChildItem -LiteralPath (Join-Path $projectRoot 'scripts') -File -Recurse
  $app=Join-Path $projectRoot 'app'
  $files+=Get-ChildItem -LiteralPath $app -File -Force
  foreach($relative in @('src','public','tests','src-tauri\src','src-tauri\icons','src-tauri\capabilities')){$files+=Get-ChildItem -LiteralPath (Join-Path $app $relative) -File -Recurse}
  $files+=Get-ChildItem -LiteralPath (Join-Path $app 'src-tauri') -File
  foreach($file in $files){$entry='sreda/'+$file.FullName.Substring($projectRoot.Length+1).Replace('\','/');[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$entry,[System.IO.Compression.CompressionLevel]::Optimal)|Out-Null}
} finally {$archive.Dispose()}
