---
title: Plugins
audience: admin
related: new-endpoint, overview
---

A plugin connects one kind of upstream service. Use this page to add plugin repositories, install and update plugins, and enable them for endpoints.

A plugin runs in its own process and reads only its own files. It can reach the network. The hosts that it declares show under its name on the **Installed** tab.

## Add a signed repository

A signed repository proves each download with a minisign key. You confirm the key once, and the server keeps it.

1. On the **Repositories** tab, choose **Add repository**.
2. Enter the **Index URL**. The server fetches only `https` addresses.
3. Keep **Signed** under **Signing**, and choose **Fetch key**.
4. Compare the key that the dialog shows with the key on the website or README of the publisher.
5. Paste the copy of the publisher into **Publisher's public key**. Do not copy the key from the dialog.
6. Choose **Add repository**.

A pasted key that does not match the published key is refused. A repository that publishes no key cannot be added as signed.

An unsigned repository checks only the checksum in its index. Whoever controls that index controls the code. Each install from it shows a warning.

## Install a plugin

1. On the **Available** tab, choose **Install…** on the plugin.
2. Pick a **Version**. You cannot pick a version marked **(incompatible)**. It does not fit this server.
3. Choose **Install**.

A new plugin starts disabled. Review what it may do and the hosts that it contacts. Then choose **Enable** on the **Installed** tab. After that, you can add an endpoint for it.

## Update a plugin or go back to an earlier version

An **update** mark on the **Available** tab shows that a newer version is there.

1. Choose **Update…** on the plugin, or **Reinstall…** when no newer version is there.
2. Pick the version. To roll back, pick an earlier version.
3. Choose **Install**.

The endpoints of the plugin stop during the install and start again after it. Open approvals and session grants on them end. Their connections and access levels stay.

An update that changes what the plugin may do disables the plugin. Examples are a new network host or new capabilities. Its endpoints stay stopped until you choose **Enable**.

You can go back only to a version that the repository still offers.

## Confirm a changed signing key

When a signed repository starts to use a new key, its **Signing** column shows **key changed**. Installs and updates from it stop.

A key change that you did not expect can mean that someone took over the repository. Ask the publisher before you trust it.

1. Choose **Review key…** on the repository.
2. Compare the offered key with the new key that the publisher announces.
3. Paste the publisher's copy into **Publisher's new public key**.
4. Choose **Trust new key**.

The old key does not unblock the repository. A new key can have the same key id as the old one, so compare the full key.

## Install a plugin from a file

Use a file to test a plugin build before its release. The file must be a `.tgz` of 50 MB at most.

1. Choose **Install from file**, pick the file, then choose **Upload**.
2. Check the plugin, the version, the checksum and what the file replaces.
3. Choose **Install** within 15 minutes. A restart of the server also drops the upload.

Nobody signs a file. Only your review vouches for its code. If the plugin was enabled and keeps its permissions, its endpoints run the new code at once.

The plugin then shows **manual**. To go back to the version from its repository, choose **Revert to released**. An install from the repository also ends the manual build.

## Remove a plugin or a repository

**Disable** stops every endpoint of the plugin. **Uninstall** deletes the files of the plugin. You can uninstall only a plugin that has no endpoints.

You can remove a repository only when no installed plugin comes from it. Uninstall those plugins first.

## When a plugin will not start

The **Status** column shows **invalid** or **incompatible**, with the reason under it. You cannot enable such a plugin, and its endpoints do not start.

- **invalid**: a file of the plugin is missing or broken. Install the plugin again from its repository.
- **incompatible**: the plugin needs another plugin SDK. Install a version that fits this server.

After you change files in the plugins folder by hand, choose **Rescan**.

## When an install or a repository fails

- **Installed from another repository**: the plugin came from another repository. Uninstall it before you install it from this one.
- An error under the repository name: the last fetch failed. The server fetches each repository once a day. Choose **Refresh** to try at once.
- A checksum or signature that does not match stops the install. The old files stay.
