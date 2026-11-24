# CMEC E-Borrow App

ระบบยืม-คืนหุ่นและอุปกรณ์ simulation (Node.js + Express + SQLite ในตัว Node)

## ติดตั้งและรัน
ต้องใช้ Node.js 22.5 ขึ้นไป (มี `node:sqlite` ในตัว)

```bash
npm install
npm start
```

- ผู้ใช้: `http://<ip-เครื่อง-server>:3000/login.html`
- Admin: `http://<ip-เครื่อง-server>:3000/admin-login.html`
- เปลี่ยนพอร์ตด้วยตัวแปร `PORT`

## บัญชีเริ่มต้น (สร้างอัตโนมัติครั้งแรก — กรุณาเปลี่ยนรหัสทันที)
| สิทธิ์ | ชื่อผู้ใช้ | รหัสผ่าน |
|---|---|---|
| Admin | admin | admin1234 |
| ผู้ใช้ | user | user1234 |

## ข้อมูล
- ฐานข้อมูล: `data/eborrow.db` (สำรองไฟล์นี้เป็นประจำ)
- รูปที่อัปโหลด: `data/uploads/`
- รายการหุ่นเริ่มต้นสร้างจากชื่อไฟล์ใน `pic/` (`<รหัส>-<ชื่อ>.jpg`) เมื่อฐานข้อมูลยังว่าง
- สถิติเก็บแยกรายเดือน: เดือนใหม่เริ่มนับจาก 0 อัตโนมัติ และดูย้อนหลังได้

## สำรองข้อมูล
```bash
npm run backup
```
หรือดับเบิลคลิก `backup-db.bat` — รันได้ขณะเซิร์ฟเวอร์ทำงานอยู่

- สร้างโฟลเดอร์ `backups/eborrow-<วันที่_เวลา>/` มี `eborrow.db`, `uploads/`, `secret.key` และตรวจความสมบูรณ์ของสำเนาให้อัตโนมัติ
- เก็บ 30 ชุดล่าสุด (เปลี่ยนด้วย `BACKUP_KEEP`) — เก็บไว้ไดรฟ์อื่นด้วย `BACKUP_DIR` (แก้ได้ใน `backup-db.bat`)
- ตั้งให้รันทุกวันอัตโนมัติ (Task Scheduler ของ Windows) — รันใน PowerShell ครั้งเดียว:
  ```powershell
  $dir = 'D:\AI\claude\CMEC Eborow App0.1.1'
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$dir\backup-db.bat`" auto`"" -WorkingDirectory $dir
  $trigger = New-ScheduledTaskTrigger -Daily -At 18:00
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
  Register-ScheduledTask -TaskName 'CMEC E-Borrow Backup' -Action $action -Trigger $trigger -Settings $settings -Force
  ```
  (ถ้าเครื่องปิดอยู่ตอน 18:00 จะสำรองให้ทันทีที่เปิดเครื่อง — ถ้าย้ายโฟลเดอร์แอปต้องแก้ `$dir` แล้วรันใหม่)
- กู้คืน: ปิดเซิร์ฟเวอร์ → คัดลอก `eborrow.db`, `uploads/`, `secret.key` จากชุดที่ต้องการกลับไปไว้ใน `data/` → ลบ `data/eborrow.db-wal` และ `data/eborrow.db-shm` (ถ้ามี) → เปิดเซิร์ฟเวอร์ใหม่
