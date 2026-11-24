# Handoff — CMEC E-Borrow App (บันทึก 8 พ.ย. 2569)

## สถานะปัจจุบัน
- แอปทำงานได้ครบตามแผน: login แยก user/admin, ดูหุ่นว่าง, จองล่วงหน้า (จองแล้วอนุมัติทันที), แจ้งซ่อม, คู่มือ, admin จัดการหุ่น/การจอง/แจ้งซ่อม/ผู้ใช้/สถิติรายเดือน
- Stack: Node.js 22.5+ / Express / `node:sqlite` — รันด้วย `npm start` (พอร์ต 3000, ถ้าไม่ว่างตั้ง `PORT`)
- GitHub: https://github.com/KKP56/cmec-eborrow-app (private, branch `main`) — gh CLI login ค้างไว้บนเครื่องนี้แล้ว (บัญชี KKP56)

## งานล่าสุด (10 พ.ย. 2569 — push แล้ว)
- เปลี่ยนอีโมจิทั้งแอปเป็น **ไอคอนเส้น SVG สีน้ำเงิน** (`ICONS` / `ic()` ใน app.js)
- **เวลาในการจอง**: คอลัมน์ `start_time`/`end_time` (migration อัตโนมัติ, ของเดิม = 08:00–16:30), ตรวจเวลาชนแบบช่วงเวลา, หน้าจองแสดงช่วงเวลาที่ถูกจองแล้ว
- ช่องวันที่/เวลาใช้ตัวเลือกของเบราว์เซอร์ + `color-scheme: light` (ผู้ใช้ไม่เอาตัวเลือกเวลาแบบทำเอง)
- หน้า **จัดการหุ่น** มีแท็บหมวดหมู่ + ตารางแบ่งกลุ่มตามหมวด

## งานล่าสุด (19–24 พ.ย. 2569)
- admin ลบบัญชีผู้ใช้ได้ (`DELETE /api/admin/users/:id` — ห้ามลบตัวเอง/admin คนสุดท้าย)
- สคริปต์สำรองข้อมูล `npm run backup` / `backup-db.bat` (ดู README หัวข้อ "สำรองข้อมูล") — ตั้ง Task Scheduler "CMEC E-Borrow Backup" บนเครื่องนี้แล้ว (ทุกวัน 18:00, เก็บใน `backups/`)
- หน้ารายการหุ่น: ตัวกรอง "ว่าง" ดูตามวัน+เวลา (`/api/items?start&end&startTime&endTime`) และกด "จอง" แล้วกรอกช่วงเวลาให้อัตโนมัติ
- รหัสบัญชีเริ่มต้น admin/user บนเครื่องนี้ถูกเปลี่ยนแล้ว

## เวอร์ชัน Google Sheets + Apps Script (ใช้งานจริงแล้ว 24 พ.ย. 2569)
- ลิงก์ใช้งาน: https://script.google.com/macros/s/AKfycbxxcNv4g2z10U_3zJS3UgSo0sMbz8OeLqY4HCBXrbL-L0XsAUaHBZOkC1w7lls7YrI0wQ/exec
- โปรเจกต์ Apps Script "Mecdical Chonburi" (ผูกกับ Google Sheet ที่เก็บข้อมูล) — Script ID `13VukLylhUSu0dmJu7Cf86TV8ImTqEMZD-jr1T0n_Hle0PuLr9XsQxGP_`
- อัปเดตโค้ดจากเครื่องใหม่: `npm install` → `node apps-script/build.js --no-data` → สร้าง `apps-script/dist/.clasp.json` = `{"scriptId":"<Script ID>","rootDir":"."}` และ `.claspignore` (SeedData.gs) → `npx.cmd @google/clasp login` → `npx.cmd @google/clasp push --force` → `npx.cmd @google/clasp update-deployment AKfycbxxcNv4g2z10U_3zJS3UgSo0sMbz8OeLqY4HCBXrbL-L0XsAUaHBZOkC1w7lls7YrI0wQ`
- ค้าง: รัน removeExtraItems (ลบหุ่น M013,M015-M018,M020,N003) ถ้ายังไม่ได้รัน แล้วเอาฟังก์ชันออก; แจ้งเตือนทางอีเมลเมื่อมีการจอง (ยังไม่ได้ทำ); ปิดระบบเดิมบนเครื่อง
- อยู่ใน `apps-script/` (ขั้นตอนติดตั้งใน `apps-script/README.md`) — ผู้ใช้เลือก "ผู้ยืมไม่ต้อง login" ใช้ชื่อ/หน่วยงาน/เบอร์โทร, มีแค่บัญชี Admin
- `node apps-script/build.js` → `apps-script/dist/` (มี SeedData.gs ข้อมูลส่วนบุคคล, gitignored)
- ทดสอบ: `node apps-script/test/backend.test.js` (14 ผ่าน) + preview `apps-script-preview` พอร์ต 3100 (Google จำลอง)
- ยังไม่ได้ทดสอบบน Google จริง: สิทธิ์ Drive/แชร์รูป, localStorage ใน iframe ของ Apps Script, ความเร็ว
- เอกสารประเมิน: https://claude.ai/artifact/7RhZC7tqnXMfymLDFu2rou (PDF ใน `docs/`)

## ยังค้าง
- เรื่องย้ายไปเซิร์ฟเวอร์โรงพยาบาล / login ด้วยบัญชีโรงพยาบาล (AD/LDAP หรือ SSO) — พักไว้ รอข้อมูลจาก IT

## สไลด์นำเสนอ (claude.ai, private)
- ภาพรวมโปรเจกต์ 10 หน้า: https://claude.ai/artifact/Uq7MKHDUq8D74d2wmrYbYF
- Interface tour 7 หน้า (ภาพหน้าจอจริง): https://claude.ai/artifact/CzdiupydauP4UWqJqQzbsJ
- ฐานข้อมูลทดสอบในเครื่องมีข้อมูลตัวอย่างจากการถ่ายภาพหน้าจอ — ลบ `data/eborrow.db` ก่อนใช้งานจริง

## ไอเดียที่คุยไว้ (ยังไม่ได้ทำ)
- ตั้ง PM2 ให้แอปเปิดเองตอนบูตเครื่องเซิร์ฟเวอร์
- Dockerfile
- เอาขึ้นโฮสต์ (VPS + Caddy หรือ Railway + Volume ที่ `/app/data`)

## บัญชีเริ่มต้น (ฐานข้อมูลใหม่ — บนเครื่องนี้เปลี่ยนรหัสแล้ว)
- admin / admin1234, user / user1234
