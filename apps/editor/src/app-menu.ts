// The Mac menu bar: Tauri's standard menus, plus "Check for Updates…" in
// the app menu (under About, where Mac apps put it) and in Help. Other
// systems have no menu bar in the editor window, so this is Mac only.
import type { Submenu as SubmenuItem } from '@tauri-apps/api/menu';
import { CAN_EXPORT_MAC, IN_DESKTOP_APP } from './platform.js';
import { updates } from './updater.js';

/** True on the desktop app on a Mac (the same test Mac exports use). */
const ON_MAC = IN_DESKTOP_APP && CAN_EXPORT_MAC;

export async function installAppMenu(): Promise<void> {
  if (!ON_MAC) return;
  const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu');
  const menu = await Menu.default();
  const item = () =>
    MenuItem.new({ text: 'Check for Updates…', action: () => void updates.check(true) });

  const submenus = (await menu.items()).filter((i): i is SubmenuItem => i instanceof Submenu);
  // The app menu comes first: About, then the check, then a separator before the rest.
  const appMenu = submenus[0];
  if (appMenu) {
    await appMenu.insert([await item(), await PredefinedMenuItem.new({ item: 'Separator' })], 1);
  }
  let help: SubmenuItem | undefined;
  for (const submenu of submenus) {
    if ((await submenu.text()) === 'Help') help = submenu;
  }
  if (!help) {
    help = await Submenu.new({ text: 'Help' });
    await menu.append(help);
  }
  await help.append(await item());
  await menu.setAsAppMenu();
  await help.setAsHelpMenuForNSApp();
}
