import { Route, Routes } from "react-router";
import { AppLayout, GuestOnly, RequireAuth } from "./components/Layout";
import { AccountPage } from "./features/account/AccountPage";
import { AdminAudit } from "./features/admin/AdminAudit";
import { AdminDashboard } from "./features/admin/AdminDashboard";
import { AdminJobs } from "./features/admin/AdminJobs";
import { AdminLayout } from "./features/admin/AdminLayout";
import { AdminUserDetail } from "./features/admin/AdminUserDetail";
import { AdminUsers } from "./features/admin/AdminUsers";
import { LoginPage, PrivacyPage, SignupDonePage, SignupPage, TermsPage } from "./features/auth/AuthPages";
import { HistoryPage } from "./features/history/HistoryPage";
import { JobDetailPage } from "./features/history/JobDetailPage";
import { HomePage } from "./features/home/HomePage";
import { CompressPage } from "./features/tools/CompressPage";
import { ResizePage } from "./features/tools/ResizePage";
import { UpscalePage } from "./features/tools/UpscalePage";

export function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signup/done" element={<SignupDonePage />} />
      </Route>
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="/upscale" element={<UpscalePage />} />
          <Route path="/resize" element={<ResizePage />} />
          <Route path="/compress" element={<CompressPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:jobId" element={<JobDetailPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route element={<RequireAuth admin />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/:userId" element={<AdminUserDetail />} />
              <Route path="jobs" element={<AdminJobs />} />
              <Route path="audit" element={<AdminAudit />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
    </div>
  );
}
