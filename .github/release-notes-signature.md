
## Check the signature

The SHA-256 list and the Linux package are signed with the developer's release key (`SHA256SUMS.txt.asc` and
`idena-client-linux-<version>.deb.asc`). The key's public half is `release-signing-key.asc` in the repository; its
fingerprint is at the end of these notes. With GnuPG, in the folder of the downloads:

```
curl -fLO https://raw.githubusercontent.com/truongfelix/idena-desktop/master/release-signing-key.asc
gpg --import release-signing-key.asc
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
gpg --verify idena-client-linux-<version>.deb.asc idena-client-linux-<version>.deb
```

Each check says "Good signature" and names the key's fingerprint. Then compare your download's SHA-256 with the
signed list.
