' Sanatify MES Web Server - hidden watchdog launcher (no console window)
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
nodeExe  = "C:\Program Files\nodejs\node.exe"
serverJs = "D:\MES  SANATIFY APP\web-server\web-server\server.js"
flagPath = "D:\MES  SANATIFY APP\web-server\web-server\stop.flag"
failCount = 0
Do
  If fso.FileExists(flagPath) Then Exit Do
  t0 = Timer
  ' window 0 = hidden, True = wait until node exits
  WshShell.Run Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & serverJs & Chr(34), 0, True
  t1 = Timer
  If fso.FileExists(flagPath) Then Exit Do
  ' if node died too fast (<5s, e.g. port busy), increase counter
  If (t1 - t0) < 5 Then
    failCount = failCount + 1
    If failCount >= 5 Then Exit Do
  Else
    failCount = 0
  End If
  WScript.Sleep 3000
Loop