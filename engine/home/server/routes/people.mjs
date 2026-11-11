// CONTRACTS 9.6, the People page: staff, leave and attendance.
import { dateText, departmentPage, figure, inboxIdOf, istNow, listDocs, listDrafts, section } from "./_departments.mjs";

// Document and field names in the books. Change them here if the books name them differently.
const T = {
  employee: { doctype: "Employee", fields: ["name", "employee_name", "designation", "date_of_joining", "status"] },
  leave: { doctype: "Leave Application", fields: ["name", "employee_name", "from_date", "to_date", "status", "docstatus", "owner"] },
  attendance: { doctype: "Attendance", fields: ["name", "employee_name", "attendance_date", "status", "docstatus", "owner"] },
};
const DEF = { id: "people", title: "People", agentSlug: "people", agentName: "People", mainDoctype: T.employee.doctype, switches: [] };

async function build(ctx) {
  const { today, weekAgo } = istNow();
  const [staff, onLeave, leave, attendance, drafts] = await Promise.all([
    listDocs(ctx, T.employee.doctype, { fields: T.employee.fields, filters: [["status", "=", "Active"]], order_by: "employee_name asc" }),
    listDocs(ctx, T.leave.doctype, {
      fields: T.leave.fields, filters: [["docstatus", "=", 1], ["from_date", "<=", today], ["to_date", ">=", today]],
    }),
    listDocs(ctx, T.leave.doctype, { fields: T.leave.fields, filters: [["docstatus", "<", 2]], order_by: "from_date desc", limit: 50 }),
    listDocs(ctx, T.attendance.doctype, {
      fields: T.attendance.fields, filters: [["docstatus", "<", 2], ["attendance_date", ">=", weekAgo]], order_by: "attendance_date desc", limit: 100,
    }),
    listDrafts(ctx, "people"),
  ]);
  const inbox = new Set(drafts.map((d) => d.id));
  const link = (doctype, d) => (inbox.has(inboxIdOf(doctype, d.name)) ? inboxIdOf(doctype, d.name) : undefined);
  const status = (d) => (Number(d.docstatus) === 0 ? "Waiting for you" : d.status);
  return {
    figures: [
      figure("staff", "People", String(staff.length)),
      figure("on_leave_today", "On leave today", String(new Set(onLeave.map((l) => l.employee_name)).size)),
      figure("leave_waiting", "Leave requests waiting", String(drafts.filter((d) => d.doctype === T.leave.doctype).length)),
    ],
    sections: [
      section("staff", "People", "No one has been added yet.", [["name", "Name"], ["job", "Job"], ["joined", "Joined"]],
        staff.map((e) => ({ name: e.employee_name, job: e.designation || "", joined: dateText(e.date_of_joining) }))),
      section("leave", "Leave", "No leave requests.", [["who", "Who"], ["from", "From"], ["to", "To"], ["status", "Status"]],
        leave.map((l) => ({ who: l.employee_name, from: dateText(l.from_date), to: dateText(l.to_date), status: status(l), inboxId: link(T.leave.doctype, l) }))),
      section("attendance", "Attendance, last 7 days", "No attendance marked this week.", [["who", "Who"], ["date", "Date"], ["status", "Status"]],
        attendance.map((a) => ({ who: a.employee_name, date: dateText(a.attendance_date), status: status(a), inboxId: link(T.attendance.doctype, a) }))),
    ],
  };
}

export default function register(app) {
  app.get("/api/departments/people", (ctx) => departmentPage(ctx, DEF, build));
}
