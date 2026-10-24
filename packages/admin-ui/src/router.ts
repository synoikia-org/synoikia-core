import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw, RouterHistory } from 'vue-router';
import { setUnauthenticatedHandler } from './api';
import { pageTitle } from './format';
import AppShell from './layouts/AppShell.vue';
import { useSessionStore } from './stores/session';
import AuditView from './views/AuditView.vue';
import ClientsView from './views/ClientsView.vue';
import EnrollTotpView from './views/EnrollTotpView.vue';
import AccessPage from './views/instance/AccessPage.vue';
import ConnectionView from './views/instance/ConnectionView.vue';
import InstanceLayout from './views/instance/InstanceLayout.vue';
import InstanceSettingsView from './views/instance/InstanceSettingsView.vue';
import RulesView from './views/instance/RulesView.vue';
import LoginView from './views/LoginView.vue';
import MyEndpointAboutView from './views/MyEndpointAboutView.vue';
import MyEndpointView from './views/MyEndpointView.vue';
import MyEndpointsView from './views/MyEndpointsView.vue';
import NewEndpointView from './views/NewEndpointView.vue';
import OverviewView from './views/OverviewView.vue';
import PluginsView from './views/PluginsView.vue';
import ProfileView from './views/ProfileView.vue';
import ClientAuthView from './views/settings/ClientAuthView.vue';
import NotificationsView from './views/settings/NotificationsView.vue';
import SettingsLayout from './views/settings/SettingsLayout.vue';
import RolesView from './views/settings/RolesView.vue';
import ServerSettingsView from './views/settings/ServerSettingsView.vue';
import UserAuthView from './views/settings/UserAuthView.vue';
import UsersView from './views/settings/UsersView.vue';
import SetupView from './views/SetupView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    title?: string;
    /** Only the Admin role (ADR-0010); the API refuses the rest anyway. */
    admin?: boolean;
    /** The help topic of the page, a file in src/help (@id:portal-help). */
    help?: string;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/login', component: LoginView, meta: { public: true, title: 'Sign in' } },
  { path: '/setup', component: SetupView, meta: { public: true, title: 'Setup' } },
  { path: '/enroll-totp', component: EnrollTotpView, meta: { title: 'Two-factor setup' } },
  {
    path: '/',
    component: AppShell,
    children: [
      { path: '', component: OverviewView, meta: { title: 'Overview', admin: true, help: 'overview' } },
      { path: 'audit', component: AuditView, meta: { title: 'Audit Log', admin: true, help: 'audit' } },
      { path: 'plugins', component: PluginsView, meta: { title: 'Plugins', admin: true, help: 'plugins' } },
      { path: 'clients', component: ClientsView, meta: { title: 'Clients & Tokens', admin: true, help: 'clients' } },
      {
        path: 'endpoints/new',
        component: NewEndpointView,
        meta: { title: 'New endpoint', admin: true, help: 'new-endpoint' },
      },
      { path: 'my', component: MyEndpointsView, meta: { title: 'My endpoints', help: 'my-endpoints' } },
      { path: 'my/:id', component: MyEndpointView, meta: { title: 'Endpoint', help: 'my-endpoint' } },
      { path: 'my/:id/about', component: MyEndpointAboutView, meta: { title: 'Endpoint', help: 'my-endpoint' } },
      { path: 'profile', component: ProfileView, meta: { title: 'My profile', help: 'profile' } },
      {
        path: 'endpoints/:slug',
        component: InstanceLayout,
        meta: { admin: true },
        children: [
          { path: '', redirect: (to) => `/endpoints/${String(to.params.slug)}/connection` },
          { path: 'connection', component: ConnectionView, meta: { title: 'Connection', help: 'connection' } },
          { path: 'access', component: AccessPage, meta: { title: 'Access', help: 'access' } },
          { path: 'rules', component: RulesView, meta: { title: 'Pre-Approval Rules', help: 'rules' } },
          {
            path: 'settings',
            component: InstanceSettingsView,
            meta: { title: 'Endpoint Settings', help: 'endpoint-settings' },
          },
        ],
      },
      // Old links to the profile page; keep the query.
      { path: 'settings/profile', redirect: (to) => ({ path: '/profile', query: to.query }) },
      {
        path: 'settings',
        component: SettingsLayout,
        meta: { admin: true },
        children: [
          { path: '', redirect: '/settings/client-auth' },
          { path: 'mcp', redirect: '/settings/client-auth' },
          { path: 'client-auth', component: ClientAuthView, meta: { title: 'Client auth', help: 'client-auth' } },
          { path: 'security', redirect: '/settings/user-auth' },
          { path: 'user-auth', component: UserAuthView, meta: { title: 'User auth', help: 'user-auth' } },
          { path: 'users', component: UsersView, meta: { title: 'Users', help: 'users' } },
          { path: 'roles', component: RolesView, meta: { title: 'Roles', help: 'roles' } },
          {
            path: 'notifications',
            component: NotificationsView,
            meta: { title: 'Notifications', help: 'notifications' },
          },
          {
            path: 'server',
            component: ServerSettingsView,
            meta: { title: 'Server settings', help: 'server-settings' },
          },
        ],
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({ history, routes });

  router.beforeEach(async (to) => {
    const session = useSessionStore();
    if (!session.loaded) await session.load();
    if (session.setupRequired) return to.path === '/setup' ? true : '/setup';
    if (to.path === '/setup') return '/';
    if (to.meta.public) return to.path === '/login' && session.authenticated ? '/' : true;
    if (!session.authenticated) {
      return { path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
    }
    if (session.mustEnrollTotp && to.path !== '/enroll-totp') return '/enroll-totp';
    if (to.matched.some((r) => r.meta.admin) && !session.isAdmin) return '/my';
    return true;
  });
  router.afterEach((to) => {
    const title = pageTitle(to);
    if (typeof document !== 'undefined') document.title = title ? `${title} · Synoikia` : 'Synoikia';
  });

  // A session that expires mid-use: back to the login page, keeping the current page.
  setUnauthenticatedHandler(() => {
    const session = useSessionStore();
    session.expire();
    const current = router.currentRoute.value;
    if (!current.meta.public) void router.replace({ path: '/login', query: { redirect: current.fullPath } });
  });
  return router;
}
