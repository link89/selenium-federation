# FAQ
Useful tips to setup a reliable browser farm.

## Auto Start on Windows
To enable the auto startup on windows, you need to create a bat script in the `Startup` folder.
To open the `Startup` folder the easy way, just hit `Windows + R` to open the `Run` box, type `shell:startup`, and then press `Enter`.
Then you can create a file named `pm2-startup.bat` and add the command `pm2 resurrect` to it.


## Auto Login Operating System
To use the auto reboot feature of `selenium-federation`, you need to ensure login the system automatically after rebooting.

### Windows

#### Before Windows 10
Press `Windows + R` and type `netplwiz` to enable the auto login option.

#### Windows 10
On windows 10 you need to enable the auto login via editing registry.

For non-domain users, create a file named `auto-login.reg` with the following content then click to run.
```
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon]
"DefaultUserName"="USERNAME"
"DefaultPassword"="PASSWORD"
"AutoAdminLogon"="1"
```

For domain users, the content would be a little bit complicated.
```
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon]
"DefaultDomainName"="DOMAIN_NAME"
"AltDefaultDomainName"="DOMAIN_NAME"
"CachePrimaryDomain"="DOMAIN_NAME"
"DefaultUserName"="USERNAME"
"AltDefaultUserName"="USERNAME"
"DefaultPassword"="PASSWORD"
"AutoAdminLogon"="1"
```



### Mac OSX
Open `System Preferences > Users & Groups > Login Options` to enable the auto login option.