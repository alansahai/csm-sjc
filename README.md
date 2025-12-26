# Catechism Student Management System (CSMS)

A web-based Student Management System designed for church catechism classes.
CSMS streamlines student records, attendance tracking, and role-based access for admins, faculty, and students using Firebase as the backend.

🔗 **Live Deployment:** [https://csmsjc.vercel.app](https://csmsjc.vercel.app)

---

## 🚀 Features

### 🔐 Authentication & Role Management
- Firebase Authentication
- Role-based access control:
  - **Admin**
  - **Faculty / Teacher**
  - **Student**

### 👨‍🏫 Admin Panel
- Manage students and faculty
- Control access and permissions
- Centralized system configuration

### 📚 Faculty Dashboard
- View and manage assigned students
- Update student-related data
- Access attendance-related resources

### 🎓 Student Portal
- View personal profile and details
- Secure, read-only access to assigned information

### 🌐 Web Application
- Responsive UI built with HTML, CSS, and JavaScript
- Clean and simple UX for non-technical users
- Deployed on **Vercel** for fast global access

---

## 🛠️ Tech Stack

**Frontend**
- HTML5
- CSS3
- Vanilla JavaScript

**Backend / Services**
- Firebase Authentication
- Firebase Firestore
- Firebase Hosting (config support)

**Deployment**
- Vercel

---

## 📁 Project Structure

```text
├── index.html          # Login page
├── admin.html          # Admin dashboard
├── faculty.html        # Faculty dashboard
├── student.html        # Student portal
├── css/
│   └── style.css       # Global styles
├── js/
│   ├── auth.js         # Authentication logic
│   ├── admin.js        # Admin functionalities
│   ├── faculty.js      # Faculty functionalities
│   ├── student.js      # Student functionalities
│   └── common.js       # Shared utilities
├── assets/             # Images & icons
├── firebase.config.js  # Firebase configuration
├── firebase.json       # Firebase hosting config
├── .env                # Environment variables
└── package.json

```

---

## ⚙️ Setup & Local Development

1. **Clone the repository**
```bash
git clone [https://github.com/your-username/catechism-manager.git](https://github.com/your-username/catechism-manager.git)
cd catechism-manager

```


2. **Configure Firebase**
* Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
* Enable **Authentication** (Email/Password) and **Firestore Database**
* Update `firebase.config.js` with your specific API keys


3. **Run locally**
* Open `index.html` using a local server (e.g., VS Code Live Server) to prevent CORS issues.



---

## 🔒 Security Notes

* API keys and environment configurations should be handled carefully.
* Firebase Security Rules are configured to enforce strict role-based access (Admins have full access; Students have read-only access to their own data).

---

## 📌 Future Enhancements

* [ ] Attendance marking & automated reports
* [ ] Sacrament tracking (Communion / Confirmation)
* [ ] Behaviour grading system
* [ ] Email/SMS notifications for parents
* [ ] Admin analytics dashboard

---

## 👤 Author

**Alan S**
B.E. Computer Science & Engineering
Sri Ramakrishna Institute of Technology

---

## 📄 License

This project is intended for personal use.
