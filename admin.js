let allOrders = [];
let allUsers = [];
let revenueChartInstance = null;
let adminCourses = [];
let allDiscounts = [];

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const icon = type === 'success' ? '<i class="fa-solid fa-circle-check text-green-500"></i>' : '<i class="fa-solid fa-circle-exclamation text-red-500"></i>';
    const bgColor = type === 'success' ? 'border-green-500' : 'border-red-500';

    toast.className = `bg-white dark:bg-slate-800 border-l-4 ${bgColor} shadow-lg rounded-xl p-4 flex items-center gap-3 transform transition-transform duration-300 translate-x-[120%] pointer-events-auto min-w-[250px]`;
    toast.innerHTML = `
        <div class="text-xl">${icon}</div>
        <div class="text-sm font-bold text-gray-800 dark:text-gray-200">${message}</div>
    `;
    container.appendChild(toast);

    setTimeout(() => toast.classList.remove('translate-x-[120%]'), 10);
    setTimeout(() => {
        toast.classList.add('translate-x-[120%]');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function loadOrders() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    if (!token) {
      alert("Vui lòng đăng nhập với tài khoản Admin.");
      window.location.href = 'login.html';
      return;
    }

    try {
      const response = await fetch('http://127.0.0.1:5000/api/admin/orders', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(errorData.message || 'Không thể tải dữ liệu đơn hàng.');
        if(response.status === 401 || response.status === 403) window.location.href = 'login.html';
        return;
      }

      const data = await response.json();
      allOrders = data.orders;
      renderOrders();

    } catch (error) {
      console.error("Lỗi tải đơn hàng:", error);
      alert("Lỗi kết nối tới máy chủ.");
    }
}

function renderOrders() {
    const tableBody = document.getElementById('orders-table-body');
    const searchInput = document.getElementById('admin-search-input');
    const statusFilter = document.getElementById('admin-status-filter');
    const dateFromInput = document.getElementById('admin-date-from');
    const dateToInput = document.getElementById('admin-date-to');
    
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    const filterValue = statusFilter ? statusFilter.value : 'all';
    const dateFrom = dateFromInput ? dateFromInput.value : '';
    const dateTo = dateToInput ? dateToInput.value : '';

    const filteredOrders = allOrders.filter(order => {
        const matchesSearch = order.user_fullname.toLowerCase().includes(searchTerm) || 
                              order.user_email.toLowerCase().includes(searchTerm) ||
                              `#${order.id}`.includes(searchTerm);
        let matchesStatus = true;
        if (filterValue === 'pending') matchesStatus = order.current_step === 1;
        if (filterValue === 'completed') matchesStatus = order.current_step === 3;
        if (filterValue === 'cancelled') matchesStatus = order.current_step === 4;
        
        let matchesDate = true;
        if (dateFrom || dateTo) {
            const parts = order.created_at.split(' ')[0].split('/'); // Chuyển DD/MM/YYYY thành mảng [DD, MM, YYYY]
            const orderDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
            
            if (dateFrom) {
                const from = new Date(dateFrom + "T00:00:00");
                if (orderDate < from) matchesDate = false;
            }
            if (dateTo) {
                const to = new Date(dateTo + "T23:59:59");
                if (orderDate > to) matchesDate = false;
            }
        }
        
        return matchesSearch && matchesStatus && matchesDate;
    });

    tableBody.innerHTML = '';

    if (filteredOrders.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">Không tìm thấy đơn hàng nào phù hợp.</td></tr>`;
        return;
    }

    filteredOrders.forEach(order => {
        let statusBadge = '';
        if (order.current_step === 1) {
          statusBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400">Chờ duyệt</span>`;
        } else if (order.current_step === 3) {
          statusBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400">Đã duyệt</span>`;
        } else if (order.current_step === 4) {
          statusBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400">Đã hủy</span>`;
        }

        const row = `
          <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/20">
            <td class="p-4 font-mono font-bold text-gray-500">#${order.id}</td>
            <td class="p-4">
              <p class="font-bold text-gray-800 dark:text-gray-200">${order.user_fullname}</p>
              <p class="text-xs text-gray-500">${order.user_email}</p>
            </td>
            <td class="p-4 font-semibold text-gray-600 dark:text-gray-300">${order.course_name.replace(/,/g, ', ')}</td>
            <td class="p-4 text-center">${statusBadge}</td>
            <td class="p-4 text-right font-bold text-[#0056D2] dark:text-blue-400">${Number(order.price).toLocaleString('vi-VN')} đ</td>
            <td class="p-4 text-center space-x-1">
              ${order.current_step === 1 ? `<button onclick="approveOrder(${order.id}, this)" class="px-3 py-1.5 text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors">Duyệt đơn</button>` : ''}
              ${order.current_step === 1 ? `<button onclick="cancelOrder(${order.id}, this)" class="px-3 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors">Hủy đơn</button>` : ''}
              <button onclick="downloadInvoice(${order.id})" class="px-3 py-1.5 text-xs font-bold bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors" title="Biên lai ghi danh"><i class="fa-solid fa-file-pdf"></i></button>
              <button onclick="deleteOrder(${order.id})" class="px-3 py-1.5 text-xs font-bold bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 rounded-lg transition-colors" title="Xóa ghi danh"><i class="fa-solid fa-trash-can"></i></button>
            </td>
          </tr>
        `;
        tableBody.innerHTML += row;
    });
}

function exportOrdersToCSV() {
    if (allOrders.length === 0) {
        showToast("Không có dữ liệu đơn hàng để xuất.", "error");
        return;
    }

    // Tạo tiêu đề (header) cho file CSV
    const headers = ["ID Ghi danh", "Học viên", "Email", "Khóa học", "Trạng thái", "Tổng tiền", "Ngày tạo"];
    const csvRows = [headers.join(",")];

    // Thêm dữ liệu từng đơn hàng vào
    allOrders.forEach(order => {
        let statusStr = "Không xác định";
        if (order.current_step === 1) statusStr = "Chờ duyệt";
        else if (order.current_step === 3) statusStr = "Đã duyệt";
        else if (order.current_step === 4) statusStr = "Đã hủy";
        const row = [
            order.id,
            `"${order.user_fullname}"`, // Bọc trong ngoặc kép để an toàn với dấu phẩy
            `"${order.user_email}"`,
            `"${order.course_name.replace(/,/g, ', ')}"`,
            `"${statusStr}"`,
            order.price,
            `"${order.created_at}"`
        ];
        csvRows.push(row.join(","));
    });

    const csvString = csvRows.join("\n");
    const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" }); // Thêm BOM để Excel không lỗi font
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Danh_sach_ghi_danh_Coursera_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

async function approveOrder(orderId, button) {
    if (!confirm(`Bạn có chắc chắn muốn duyệt đơn hàng #${orderId} không?`)) {
        return;
    }

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`;

    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/approve-order/${orderId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');

        if (response.ok) {
            button.parentElement.innerHTML = '<span class="text-green-500 font-bold text-xs"><i class="fa-solid fa-check"></i> Đã xử lý</span>';
            loadOrders(); 
        } else {
            button.disabled = false;
            button.innerText = 'Duyệt đơn';
        }
    } catch (error) {
        showToast('Lỗi kết nối khi duyệt đơn hàng.', 'error');
        button.disabled = false;
        button.innerText = 'Duyệt đơn';
    }
}

async function cancelOrder(orderId, button) {
    if (!confirm(`Bạn có chắc chắn muốn HỦY đơn hàng #${orderId} không?`)) {
        return;
    }

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`;

    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/cancel-order/${orderId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');

        if (response.ok) {
            button.parentElement.innerHTML = '<span class="text-green-500 font-bold text-xs"><i class="fa-solid fa-check"></i> Đã xử lý</span>';
            loadOrders(); 
        } else {
            button.disabled = false;
            button.innerText = 'Hủy đơn';
        }
    } catch (error) {
        showToast('Lỗi kết nối khi hủy đơn hàng.', 'error');
        button.disabled = false;
        button.innerText = 'Hủy đơn';
    }
}

function downloadInvoice(orderId) {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    if (!token) {
        alert("Vui lòng đăng nhập lại!");
        return;
    }
    const url = `http://127.0.0.1:5000/api/admin/invoice/${orderId}?token=${token}`;
    window.open(url, '_blank');
}

async function deleteOrder(orderId) {
    if (!confirm(`Bạn có chắc chắn muốn xóa đơn hàng #${orderId}? Hành động này không thể hoàn tác.`)) {
        return;
    }
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/orders/${orderId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            loadOrders();
        }
    } catch (error) {
        showToast("Lỗi kết nối khi xóa đơn hàng.", "error");
    }
}

async function loadUsers() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch('http://127.0.0.1:5000/api/admin/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        allUsers = data.users;
        renderUsers();
    } catch (error) {
        console.error("Lỗi tải người dùng:", error);
    }
}

function renderUsers() {
    const tableBody = document.getElementById('users-table-body');
    tableBody.innerHTML = '';
    allUsers.forEach(user => {
        let roleBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-800">Student</span>`;
        if (user.role === 'admin') roleBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-blue-100 text-blue-800">Admin</span>`;
        else if (user.role === 'teacher') roleBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-purple-100 text-purple-800">Teacher</span>`;

        const row = `
            <tr>
                <td class="p-4 font-bold">#${user.id}</td>
                <td class="p-4 font-bold text-gray-800 dark:text-gray-200">${user.fullname}</td>
                <td class="p-4 text-gray-600 dark:text-gray-300">${user.email}</td>
                <td class="p-4 text-center">${roleBadge}</td>
                <td class="p-4 text-center text-gray-500">${user.created_at}</td>
                <td class="p-4 text-center space-x-2">
                    <button onclick="openUserModal(${user.id})" class="px-3 py-1.5 text-xs font-bold bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-white rounded-lg">Sửa</button>
                    <button onclick="deleteUser(${user.id})" class="px-3 py-1.5 text-xs font-bold bg-red-100 hover:bg-red-200 text-red-600 rounded-lg">Xóa</button>
                </td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}

function exportUsersToCSV() {
    if (allUsers.length === 0) {
        showToast("Không có dữ liệu học viên để xuất.", "error");
        return;
    }

    // Tạo tiêu đề (header) cho file CSV
    const headers = ["ID", "Họ và tên", "Email", "Vai trò", "Ngày gia nhập"];
    const csvRows = [headers.join(",")];

    // Thêm dữ liệu từng học viên vào
    allUsers.forEach(user => {
        const row = [
            user.id,
            `"${user.fullname}"`, // Bọc trong ngoặc kép để tránh lỗi nếu tên chứa dấu phẩy
            `"${user.email}"`,
            user.role,
            `"${user.created_at}"`
        ];
        csvRows.push(row.join(","));
    });

    const csvString = csvRows.join("\n");
    const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" }); // \uFEFF giúp Excel nhận diện font Tiếng Việt
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Danh_sach_hoc_vien_Coursera_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function openUserModal(userId = null) {
    const modal = document.getElementById('user-modal');
    const title = document.getElementById('user-modal-title');
    const form = document.getElementById('user-form');
    form.reset();

    if (userId) {
        // Chế độ sửa
        const user = allUsers.find(u => u.id === userId);
        if (!user) return;
        title.innerText = "Chỉnh sửa thông tin học viên";
        document.getElementById('user-id-input').value = user.id;
        document.getElementById('user-fullname-input').value = user.fullname;
        document.getElementById('user-email-input').value = user.email;
        document.getElementById('user-role-input').value = user.role;
        document.getElementById('user-password-input').placeholder = "Để trống nếu không muốn đổi";
    } else {
        // Chế độ thêm mới
        title.innerText = "Thêm học viên mới";
        document.getElementById('user-id-input').value = '';
        document.getElementById('user-password-input').placeholder = "Mật khẩu bắt buộc";
        document.getElementById('user-password-input').required = true;
    }
    modal.classList.remove('hidden');
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    modal.classList.add('hidden');
    document.getElementById('user-password-input').required = false;
}

async function handleUserSubmit(event) {
    event.preventDefault();
    const userId = document.getElementById('user-id-input').value;
    const fullname = document.getElementById('user-fullname-input').value;
    const email = document.getElementById('user-email-input').value;
    const password = document.getElementById('user-password-input').value;
    const role = document.getElementById('user-role-input').value;

    const url = userId ? `/api/admin/users/${userId}` : '/api/admin/users';
    const method = userId ? 'PUT' : 'POST';

    const body = { fullname, email, role };
    if (password) {
        body.password = password;
    }

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;

    try {
        const response = await fetch(`http://127.0.0.1:5000${url}`, {
            method: method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            closeUserModal();
            loadUsers();
        }
    } catch (error) {
        showToast("Lỗi kết nối khi xử lý thông tin người dùng.", "error");
    }
}

async function deleteUser(userId) {
    if (!confirm(`Bạn có chắc chắn muốn xóa người dùng #${userId}? Hành động này không thể hoàn tác.`)) {
        return;
    }
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            loadUsers();
        }
    } catch (error) {
        showToast("Lỗi kết nối khi xóa người dùng.", "error");
    }
}

function switchAdminTab(tabName) {
    const views = ['dashboard', 'orders', 'users', 'courses', 'discounts'];
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if(el) el.classList.add('hidden');
    });

    const targetView = document.getElementById(`view-${tabName}`);
    if(targetView) targetView.classList.remove('hidden');

    document.querySelectorAll('#admin-nav a').forEach(a => {
        a.classList.remove('bg-blue-50', 'dark:bg-blue-900/40', 'text-[#0056D2]', 'dark:text-blue-400');
        a.classList.add('hover:bg-gray-100', 'dark:hover:bg-slate-800');
    });
    const activeLink = document.querySelector(`#admin-nav a[data-tab="${tabName}"]`);
    if(activeLink) {
        activeLink.classList.add('bg-blue-50', 'dark:bg-blue-900/40', 'text-[#0056D2]', 'dark:text-blue-400');
        activeLink.classList.remove('hover:bg-gray-100', 'dark:hover:bg-slate-800');
    }

    if (tabName === 'dashboard') {
        loadRevenueData();
    }
    if (tabName === 'orders' && allOrders.length === 0) {
        loadOrders();
    }
    if (tabName === 'users' && allUsers.length === 0) {
        loadUsers();
    }
    if (tabName === 'courses' && adminCourses.length === 0) {
        loadAdminCourses();
    }
    if (tabName === 'discounts' && allDiscounts.length === 0) {
        loadDiscounts();
    }
}

async function loadRevenueData() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    if (!token) return;
    try {
        const response = await fetch('http://127.0.0.1:5000/api/admin/revenue', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
            renderRevenueChart(data.revenue);
        }
    } catch (error) {
        console.error("Lỗi tải thống kê doanh thu:", error);
    }
}

function renderRevenueChart(revenueData) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;

    const labels = revenueData.map(item => item.date);
    const values = revenueData.map(item => item.total_revenue);

    if (revenueChartInstance) {
        revenueChartInstance.destroy();
    }

    revenueChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Doanh thu (VNĐ)',
                data: values,
                backgroundColor: 'rgba(0, 86, 210, 0.8)',
                borderColor: 'rgba(0, 86, 210, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString('vi-VN') + ' đ';
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.raw.toLocaleString('vi-VN') + ' đ';
                        }
                    }
                }
            }
        }
    });
}

async function loadAdminCourses() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch('http://127.0.0.1:5000/api/admin/courses', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
            adminCourses = data.courses;
            renderAdminCourses();
        }
    } catch (error) {
        console.error("Lỗi tải danh sách khóa học:", error);
    }
}

function renderAdminCourses() {
    const container = document.getElementById('admin-courses-container');
    if (!container) return;
    container.innerHTML = '';

    adminCourses.forEach(course => {
        let html = `<div class="bg-white dark:bg-[#0B0F19] p-6 rounded-2xl border border-gray-200 dark:border-slate-800 mb-6">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-xl font-black text-[#0056D2] dark:text-blue-500">${course.title} <span class="text-xs font-semibold text-gray-500 ml-2">(${course.badge})</span></h3>
                <div class="space-x-2 flex items-center">
                    <button onclick="openAddWeekModal('${course.id}')" class="px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 rounded-lg text-xs font-bold transition-colors shadow-sm"><i class="fa-solid fa-plus mr-1"></i> Thêm Tuần</button>
                    <button onclick="openCourseEditModal('${course.id}')" class="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-[#0056D2] dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-lg text-xs font-bold transition-colors shadow-sm"><i class="fa-solid fa-pen mr-1"></i> Sửa Khóa học</button>
                    <button onclick="deleteCourse('${course.id}')" class="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg text-xs font-bold transition-colors shadow-sm"><i class="fa-solid fa-trash-can mr-1"></i> Xóa</button>
                </div>
            </div>
            <div class="space-y-4">`;
        
        course.weeks.forEach(week => {
            html += `<div class="ml-2 border-l-2 border-gray-200 dark:border-slate-700 pl-4 mb-4">
                <div class="flex items-center justify-between mb-2 mt-4">
                    <h4 class="font-bold text-gray-800 dark:text-gray-200 uppercase text-xs tracking-wider">Tuần ${week.week_number}: ${week.title}</h4>
                    <div class="space-x-1 flex items-center">
                        <button onclick="openAddLessonModal(${week.id})" class="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 rounded-lg text-[10px] font-bold transition-colors"><i class="fa-solid fa-plus mr-1"></i> Bài học</button>
                        <button onclick="deleteWeek(${week.id})" class="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 rounded-lg text-[10px] font-bold transition-colors" title="Xóa tuần học"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
                <ul class="space-y-2">`;
            
            week.items.forEach(lesson => {
                html += `<li class="flex items-center justify-between bg-gray-50 dark:bg-slate-800/50 p-3 rounded-xl border border-gray-100 dark:border-slate-800">
                    <div class="flex items-center gap-3">
                      <i class="fa-solid ${lesson.type === 'video' ? 'fa-play-circle text-blue-500' : 'fa-microchip text-purple-500'}"></i>
                      <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">${lesson.title}</span>
                    </div>
                    <div class="space-x-1 flex items-center">
                        <button onclick="openLessonEditModal('${course.id}', ${week.id}, ${lesson.id})" class="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-[#0056D2] dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-lg text-xs font-bold transition-colors shadow-sm"><i class="fa-solid fa-pen mr-1"></i> Sửa</button>
                        <button onclick="deleteLesson(${lesson.id})" class="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg text-xs font-bold transition-colors shadow-sm"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </li>`;
            });
            
            html += `</ul></div>`;
        });
        
        html += `</div></div>`;
        container.innerHTML += html;
    });
}

function openCourseEditModal(courseId) {
    const course = adminCourses.find(c => c.id === courseId);
    if (!course) return;

    document.getElementById('edit-course-id').value = course.id;
    document.getElementById('edit-course-title').value = course.title || '';
    document.getElementById('edit-course-badge').value = course.badge || '';
    document.getElementById('edit-course-icon').value = course.icon || '';
    document.getElementById('upload-status').classList.add('hidden');

    document.getElementById('course-modal').classList.remove('hidden');
}

function closeCourseEditModal() {
    document.getElementById('course-modal').classList.add('hidden');
}

async function handleCourseSubmit(event) {
    event.preventDefault();
    const courseId = document.getElementById('edit-course-id').value;
    const btn = document.getElementById('course-submit-btn');

    const body = {
        title: document.getElementById('edit-course-title').value,
        badge: document.getElementById('edit-course-badge').value,
        icon: document.getElementById('edit-course-icon').value
    };

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang lưu...`;
    btn.disabled = true;

    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/courses/${courseId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            closeCourseEditModal();
            loadAdminCourses(); 
        }
    } catch (error) {
        showToast("Lỗi kết nối khi cập nhật khóa học.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function handleThumbnailUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('upload-status');
    statusEl.classList.remove('hidden');
    statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang tải lên...`;
    statusEl.className = "text-xs font-bold text-blue-500 mt-2";

    const formData = new FormData();
    formData.append('file', file);

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;

    try {
        const response = await fetch('http://127.0.0.1:5000/api/admin/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            document.getElementById('edit-course-icon').value = data.url;
            statusEl.innerHTML = `<i class="fa-solid fa-check"></i> Tải ảnh thành công!`;
            statusEl.className = "text-xs font-bold text-green-500 mt-2";
        } else {
            statusEl.innerHTML = `<i class="fa-solid fa-times"></i> ${data.message || 'Lỗi tải ảnh'}`;
            statusEl.className = "text-xs font-bold text-red-500 mt-2";
        }
    } catch (error) {
        statusEl.innerHTML = `<i class="fa-solid fa-times"></i> Lỗi kết nối máy chủ`;
        statusEl.className = "text-xs font-bold text-red-500 mt-2";
    }
    
    event.target.value = '';
}

function openAddCourseModal() {
    document.getElementById('add-course-form').reset();
    document.getElementById('add-upload-status').classList.add('hidden');
    document.getElementById('add-course-modal').classList.remove('hidden');
}

function closeAddCourseModal() {
    document.getElementById('add-course-modal').classList.add('hidden');
}

async function handleAddCourseSubmit(event) {
    event.preventDefault();
    const btn = document.getElementById('add-course-submit-btn');

    const body = {
        id: document.getElementById('add-course-id').value,
        title: document.getElementById('add-course-title').value,
        price: parseInt(document.getElementById('add-course-price').value) || 0,
        badge: document.getElementById('add-course-badge').value,
        icon: document.getElementById('add-course-icon').value
    };

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang thêm...`;
    btn.disabled = true;

    try {
        const response = await fetch('http://127.0.0.1:5000/api/admin/courses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            closeAddCourseModal();
            loadAdminCourses(); 
        }
    } catch (error) {
        showToast("Lỗi kết nối khi thêm khóa học.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function handleAddThumbnailUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('add-upload-status');
    statusEl.classList.remove('hidden');
    statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang tải lên...`;
    statusEl.className = "text-xs font-bold text-blue-500 mt-2";

    const formData = new FormData();
    formData.append('file', file);

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;

    try {
        const response = await fetch('http://127.0.0.1:5000/api/admin/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            document.getElementById('add-course-icon').value = data.url;
            statusEl.innerHTML = `<i class="fa-solid fa-check"></i> Tải ảnh thành công!`;
            statusEl.className = "text-xs font-bold text-green-500 mt-2";
        } else {
            statusEl.innerHTML = `<i class="fa-solid fa-times"></i> ${data.message || 'Lỗi tải ảnh'}`;
            statusEl.className = "text-xs font-bold text-red-500 mt-2";
        }
    } catch (error) {
        statusEl.innerHTML = `<i class="fa-solid fa-times"></i> Lỗi kết nối máy chủ`;
        statusEl.className = "text-xs font-bold text-red-500 mt-2";
    }
    
    event.target.value = '';
}

async function deleteCourse(courseId) {
    if (!confirm(`Bạn có chắc chắn muốn xóa khóa học '${courseId}'? Hành động này sẽ xóa khóa học khỏi hệ thống.`)) {
        return;
    }
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/courses/${courseId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            loadAdminCourses();
        }
    } catch (error) {
        showToast("Lỗi kết nối khi xóa khóa học.", "error");
    }
}

function openLessonEditModal(courseId, weekId, lessonId) {
    const course = adminCourses.find(c => c.id === courseId);
    const week = course.weeks.find(w => w.id === weekId);
    const lesson = week.items.find(l => l.id === lessonId);
    if (!lesson) return;

    document.getElementById('edit-lesson-id').value = lesson.id;
    document.getElementById('edit-lesson-title').value = lesson.title || '';
    document.getElementById('edit-lesson-video').value = lesson.video_url || '';
    document.getElementById('edit-lesson-desc').value = lesson.description || '';
    
    document.getElementById('edit-lesson-quiz-question').value = lesson.quiz_question || '';
    document.getElementById('edit-lesson-quiz-a').value = lesson.quiz_option_a || '';
    document.getElementById('edit-lesson-quiz-b').value = lesson.quiz_option_b || '';
    document.getElementById('edit-lesson-quiz-correct').value = lesson.quiz_correct_answer || '';
    document.getElementById('edit-lesson-flag').value = lesson.flag || '';

    document.getElementById('lesson-modal').classList.remove('hidden');
}

function closeLessonEditModal() {
    document.getElementById('lesson-modal').classList.add('hidden');
}

async function handleLessonSubmit(event) {
    event.preventDefault();
    const lessonId = document.getElementById('edit-lesson-id').value;
    const btn = document.getElementById('lesson-submit-btn');

    const body = {
        title: document.getElementById('edit-lesson-title').value,
        video_url: document.getElementById('edit-lesson-video').value,
        description: document.getElementById('edit-lesson-desc').value,
        quiz_question: document.getElementById('edit-lesson-quiz-question').value,
        quiz_option_a: document.getElementById('edit-lesson-quiz-a').value,
        quiz_option_b: document.getElementById('edit-lesson-quiz-b').value,
        quiz_correct_answer: document.getElementById('edit-lesson-quiz-correct').value,
        flag: document.getElementById('edit-lesson-flag').value
    };

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang ghi dữ liệu...`;
    btn.disabled = true;

    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/lessons/${lessonId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            closeLessonEditModal();
            loadAdminCourses(); 
        }
    } catch (error) {
        showToast("Lỗi kết nối khi cập nhật bài học.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function openAddWeekModal(courseId) {
    document.getElementById('add-week-form').reset();
    document.getElementById('add-week-course-id').value = courseId;
    document.getElementById('add-week-modal').classList.remove('hidden');
}

function closeAddWeekModal() {
    document.getElementById('add-week-modal').classList.add('hidden');
}

async function handleAddWeekSubmit(event) {
    event.preventDefault();
    const courseId = document.getElementById('add-week-course-id').value;
    const btn = document.getElementById('add-week-submit-btn');
    
    const body = {
        week_number: parseInt(document.getElementById('add-week-number').value) || 1,
        title: document.getElementById('add-week-title').value
    };

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang thêm...`;
    btn.disabled = true;

    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/courses/${courseId}/weeks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            closeAddWeekModal();
            loadAdminCourses(); 
        }
    } catch (error) {
        showToast("Lỗi kết nối khi thêm tuần học.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function deleteWeek(weekId) {
    if (!confirm(`Bạn có chắc chắn muốn xóa Tuần học này không?`)) return;
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/weeks/${weekId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) loadAdminCourses();
    } catch (error) {
        showToast("Lỗi kết nối khi xóa tuần học.", "error");
    }
}

function openAddLessonModal(weekId) {
    document.getElementById('add-lesson-form').reset();
    document.getElementById('add-lesson-week-id').value = weekId;
    document.getElementById('add-lesson-modal').classList.remove('hidden');
}

function closeAddLessonModal() {
    document.getElementById('add-lesson-modal').classList.add('hidden');
}

async function handleAddLessonSubmit(event) {
    event.preventDefault();
    const weekId = document.getElementById('add-lesson-week-id').value;
    const btn = document.getElementById('add-lesson-submit-btn');
    
    const body = {
        title: document.getElementById('add-lesson-title').value,
        type: document.getElementById('add-lesson-type').value
    };

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang thêm...`;
    btn.disabled = true;

    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/weeks/${weekId}/lessons`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            closeAddLessonModal();
            loadAdminCourses(); 
        }
    } catch (error) {
        showToast("Lỗi kết nối khi thêm bài học.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function deleteLesson(lessonId) {
    if (!confirm(`Bạn có chắc chắn muốn xóa Bài học này không?`)) return;
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/lessons/${lessonId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) loadAdminCourses();
    } catch (error) {
        showToast("Lỗi kết nối khi xóa bài học.", "error");
    }
}

// ========================================================
// QUẢN LÝ MÃ GIẢM GIÁ
// ========================================================
async function loadDiscounts() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch('http://127.0.0.1:5000/api/admin/discounts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
            allDiscounts = data.discounts;
            renderDiscounts();
        }
    } catch (error) { console.error("Lỗi tải mã giảm giá:", error); }
}

function renderDiscounts() {
    const tableBody = document.getElementById('discounts-table-body');
    tableBody.innerHTML = '';
    allDiscounts.forEach(d => {
        const statusBadge = d.is_active 
            ? `<span class="px-2 py-1 text-[10px] font-bold rounded-md bg-green-100 text-green-800 cursor-pointer hover:bg-green-200" onclick="toggleDiscountStatus(${d.id}, false)">Hoạt động</span>`
            : `<span class="px-2 py-1 text-[10px] font-bold rounded-md bg-gray-100 text-gray-800 cursor-pointer hover:bg-gray-200" onclick="toggleDiscountStatus(${d.id}, true)">Đã khóa</span>`;

        tableBody.innerHTML += `
            <tr>
                <td class="p-4 font-mono font-bold text-[#0056D2] dark:text-blue-400">${d.code}</td>
                <td class="p-4 font-black text-center text-gray-800 dark:text-gray-200">${Math.round(d.discount_rate * 100)}%</td>
                <td class="p-4 text-center">${statusBadge}</td>
                <td class="p-4 text-center text-gray-500 text-xs">${d.created_at}</td>
                <td class="p-4 text-center space-x-2">
                    <button onclick="deleteDiscount(${d.id})" class="px-3 py-1.5 text-xs font-bold bg-red-100 hover:bg-red-200 text-red-600 rounded-lg"><i class="fa-solid fa-trash-can"></i> Xóa</button>
                </td>
            </tr>
        `;
    });
}

function openDiscountModal() {
    document.getElementById('discount-form').reset();
    document.getElementById('discount-modal').classList.remove('hidden');
}
function closeDiscountModal() { document.getElementById('discount-modal').classList.add('hidden'); }

async function handleDiscountSubmit(event) {
    event.preventDefault();
    const code = document.getElementById('discount-code-input').value;
    const rate = document.getElementById('discount-rate-input').value;
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    
    try {
        const response = await fetch('http://127.0.0.1:5000/api/admin/discounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ code, rate })
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) { closeDiscountModal(); loadDiscounts(); }
    } catch (error) { showToast("Lỗi kết nối.", "error"); }
}

async function deleteDiscount(id) {
    if (!confirm("Bạn có chắc chắn muốn xóa mã giảm giá này?")) return;
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/discounts/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        if (response.ok) loadDiscounts();
    } catch (error) { showToast("Lỗi kết nối.", "error"); }
}

async function toggleDiscountStatus(id, isActive) {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`http://127.0.0.1:5000/api/admin/discounts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ is_active: isActive }) });
        if (response.ok) loadDiscounts();
    } catch (error) { showToast("Lỗi kết nối.", "error"); }
}

function toggleAdminTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function applyAdminInitialTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    applyAdminInitialTheme();
    const session = JSON.parse(localStorage.getItem('coursera_user_session'));
    if (session && session.role === 'teacher') {
        const navDash = document.getElementById('nav-item-dashboard');
        const navOrders = document.getElementById('nav-item-orders');
        const navUsers = document.getElementById('nav-item-users');
        if (navDash) navDash.classList.add('hidden');
        if (navOrders) navOrders.classList.add('hidden');
        if (navUsers) navUsers.classList.add('hidden');
        switchAdminTab('courses');
    } else {
        switchAdminTab('dashboard');
    }
});