# MessHub: IIM Lucknow night mess & counter

Student app, store POS, room runner and admin in one site. Meals go on a credit **tab**, paid at the end of term.

## Run on your PC (dev)
```
npm install
npm start          # http://localhost:3000, embedded Postgres, data saved in ./data
```
Logins (change these first!): `admin/admin123`, `pos/pos123`, `runner/runner123`, student `demo/demo123`.

## Run for real (2000+ users)
Needs Docker on a server:
```
set DB_PASSWORD=pick-a-strong-one
set JWT_SECRET=pick-a-long-random-string
docker compose up -d --build
```
Put it behind HTTPS (Cloudflare, Caddy or nginx) before students use it.

## Day-one setup (Admin screen)
1. **Menu**: import `sample-menu.csv`-style CSV (category,name,price,veg).
2. **People**: import students CSV (login,name,room,credit_limit,password). Default password = roll no.
3. Create real staff logins (role pos / runner) and disable the default ones.

## Flow
Student orders → **Queue** (POS) New → Cooking → Ready → Dine-in: Handed over / Delivery: **Runner** picks up and enters the student's 4-digit OTP → Delivered.
Counter walk-ups: POS → Counter → search student → tap items → Charge to tab.
Term end: Admin → Money → **Term bills CSV**; record payments as they come in.

## Load test
```
npm run loadtest      # 2000 logins, 2000 live connections, 2000 simultaneous orders
```
