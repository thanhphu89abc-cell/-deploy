let allOrders = [];
let allUsers = [];
let revenueChartInstance = null;
let adminCourses = [];
let allDiscounts = [];

function debounce(func, delay = 1500) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

const debouncedRenderOrders = debounce(renderOrders, 300);

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

function showConfirmModal(message, onConfirm) {
    const existing = document.getElementById('custom-confirm-modal');
    if (existing) existing.remove();

    const modalHTML = `
        <div id="custom-confirm-modal" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center animate-fade">
            <div class="bg-white dark:bg-slate-900 w-full max-w-sm mx-4 rounded-3xl p-6 border border-gray-100 dark:border-slate-800 shadow-2xl text-center transform transition-transform scale-95 duration-300" id="custom-confirm-content">
                <div class="w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white dark:border-slate-900 shadow-sm text-3xl">
                    <i class="fa-solid fa-circle-question"></i>
                </div>
                <h3 class="text-xl font-black text-gray-900 dark:text-white mb-2">Xác nhận</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-6 font-medium">${message}</p>
                <div class="flex gap-3">
                    <button id="btn-confirm-cancel" class="flex-1 py-2.5 rounded-xl font-bold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors">Hủy</button>
                    <button id="btn-confirm-ok" class="flex-1 py-2.5 rounded-xl font-bold text-white bg-[#0056D2] hover:bg-blue-700 transition-colors shadow-md">Đồng ý</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modal = document.getElementById('custom-confirm-modal');
    const content = document.getElementById('custom-confirm-content');
    
    setTimeout(() => content.classList.replace('scale-95', 'scale-100'), 10);

    const close = () => {
        modal.classList.add('opacity-0');
        content.classList.replace('scale-100', 'scale-95');
        setTimeout(() => modal.remove(), 300);
    };

    document.getElementById('btn-confirm-cancel').onclick = close;
    document.getElementById('btn-confirm-ok').onclick = () => {
        close();
        if (onConfirm) onConfirm();
    };
}

function toggleAdminSidebar() {
    const sidebar = document.getElementById('admin-sidebar');
    const backdrop = document.getElementById('admin-sidebar-backdrop');
    if (sidebar && backdrop) {
        sidebar.classList.toggle('-translate-x-full');
        backdrop.classList.toggle('hidden');
    }
}

function toggleSelectAll(type) {
    const selectAllElement = document.getElementById(`selectAll${type.charAt(0).toUpperCase() + type.slice(1)}`);
    if (!selectAllElement) return;
    const isChecked = selectAllElement.checked;
    const checkboxes = document.querySelectorAll(`.${type}-checkbox`);
    checkboxes.forEach(cb => cb.checked = isChecked);
    checkSelected(type);
}

function checkSelected(type) {
    const checkboxes = document.querySelectorAll(`.${type}-checkbox`);
    const btn = document.getElementById(`btn-delete-${type}`);
    if (!btn) return;
    const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
    
    if (anyChecked) { btn.classList.remove('hidden'); btn.classList.add('flex'); }
    else { btn.classList.add('hidden'); btn.classList.remove('flex'); }
    
    const selectAllCb = document.getElementById(`selectAll${type.charAt(0).toUpperCase() + type.slice(1)}`);
    if (selectAllCb) {
        const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
        selectAllCb.checked = allChecked;
    }
}

async function loadOrders() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    if (!token) {
      showToast("Vui lòng đăng nhập với tài khoản Admin.", "error");
      setTimeout(() => window.location.href = 'login.html', 1500);
      return;
    }

    try {
      const response = await fetch('Api/admin_api.php/orders?t=' + new Date().getTime(), {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorData = await response.json();
        showToast(errorData.message || 'Không thể tải dữ liệu đơn hàng.', 'error');
        if(response.status === 401 || response.status === 403) setTimeout(() => window.location.href = 'login.html', 1500);
        return;
      }

      const data = await response.json();
      allOrders = data.orders;
      renderOrders();

    } catch (error) {
      console.error("Lỗi tải đơn hàng:", error);
      showToast("Lỗi kết nối tới máy chủ.", "error");
    }
}

function renderOrders() {
    document.getElementById('selectAllOrders') && (document.getElementById('selectAllOrders').checked = false);
    document.getElementById('btn-delete-orders') && document.getElementById('btn-delete-orders').classList.add('hidden');
    document.getElementById('btn-delete-orders') && document.getElementById('btn-delete-orders').classList.remove('flex');

    const btnDeleteOrders = document.getElementById('btn-delete-orders');
    if (btnDeleteOrders && !document.getElementById('btn-clear-cancelled')) {
        const clearBtn = document.createElement('button');
        clearBtn.id = 'btn-clear-cancelled';
        clearBtn.className = 'px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg text-sm transition-colors flex items-center gap-2 ml-2';
        clearBtn.innerHTML = '<i class="fa-solid fa-broom"></i> Dọn đơn hủy';
        clearBtn.onclick = clearAllCancelledOrders;
        btnDeleteOrders.parentNode.appendChild(clearBtn);
    }

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
        
        const step = parseInt(order.current_step);
        let matchesStatus = true;
        if (filterValue === 'pending') matchesStatus = step === 1;
        if (filterValue === 'completed') matchesStatus = step === 3;
        if (filterValue === 'cancelled') matchesStatus = step === 4;
        
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
        tableBody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">Không tìm thấy đơn hàng nào phù hợp.</td></tr>`;
        return;
    }

    filteredOrders.forEach(order => {
        let statusBadge = '';
        const step = parseInt(order.current_step);
        if (step === 1) {
          statusBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400">Chờ duyệt</span>`;
        } else if (step === 3) {
          statusBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400">Đã duyệt</span>`;
        } else if (step === 4) {
          statusBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400">Đã hủy</span>`;
        }

        const row = `
          <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/20">
            <td class="p-4"><input type="checkbox" value="${order.id}" class="orders-checkbox rounded border-gray-300 cursor-pointer w-4 h-4 text-blue-600" onchange="checkSelected('orders')"></td>
            <td class="p-4 font-mono font-bold text-gray-500">#${order.id}</td>
            <td class="p-4">
              <p class="font-bold text-gray-800 dark:text-gray-200">${order.user_fullname}</p>
              <p class="text-xs text-gray-500">${order.user_email}</p>
            </td>
            <td class="p-4 font-semibold text-gray-600 dark:text-gray-300">${order.course_name.replace(/,/g, ', ')}</td>
            <td class="p-4 text-center">${statusBadge}</td>
            <td class="p-4 text-right font-bold text-[#0056D2] dark:text-blue-400">${Number(order.price).toLocaleString('vi-VN')} đ</td>
            <td class="p-4 text-center space-x-1">
              ${step === 1 ? `<span class="action-buttons-wrapper space-x-1"><button onclick="approveOrder(${order.id}, this)" class="px-2.5 py-1.5 text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"><i class="fa-solid fa-check"></i></button><button onclick="cancelOrder(${order.id}, this)" class="px-2.5 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"><i class="fa-solid fa-xmark"></i></button></span>` : ''}
              <button onclick="downloadInvoice(${order.id})" class="px-3 py-1.5 text-xs font-bold bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors" title="Biên lai ghi danh"><i class="fa-solid fa-file-pdf"></i></button>
              <button onclick="deleteOrder(${order.id})" class="px-3 py-1.5 text-xs font-bold bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 rounded-lg transition-colors" title="Xóa ghi danh"><i class="fa-solid fa-trash-can"></i></button>
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

    const headers = ["ID Ghi danh", "Học viên", "Email", "Khóa học", "Trạng thái", "Tổng tiền", "Ngày tạo"];
    const csvRows = [headers.join(",")];

    allOrders.forEach(order => {
        let statusStr = "Không xác định";
        const step = parseInt(order.current_step);
        if (step === 1) statusStr = "Chờ duyệt";
        else if (step === 3) statusStr = "Đã duyệt";
        else if (step === 4) statusStr = "Đã hủy";
        const row = [
            order.id,
            `"${order.user_fullname}"`, 
            `"${order.user_email}"`,
            `"${order.course_name.replace(/,/g, ', ')}"`,
            `"${statusStr}"`,
            order.price,
            `"${order.created_at}"`
        ];
        csvRows.push(row.join(","));
    });

    const csvString = csvRows.join("\n");
    const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" }); 
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Danh_sach_ghi_danh_Coursera_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

async function approveOrder(orderId, button) {
    showConfirmModal(`Bạn có chắc chắn muốn duyệt đơn hàng #${orderId} không?`, async () => {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`;

    try {
        const response = await fetch(`Api/admin_api.php/approve-order/${orderId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');

        if (response.ok) {
            button.closest('.action-buttons-wrapper').innerHTML = '<span class="text-green-500 font-bold text-xs bg-green-50 px-2 py-1.5 rounded-md border border-green-200"><i class="fa-solid fa-check"></i> Đã duyệt</span>';
            setTimeout(() => loadOrders(), 1000); 
        } else {
            button.disabled = false;
            button.innerText = 'Duyệt đơn';
        }
    } catch (error) {
        showToast('Lỗi duyệt đơn: ' + error.message, 'error');
        button.disabled = false;
        button.innerText = 'Duyệt đơn';
    }
    });
}

async function cancelOrder(orderId, button) {
    showConfirmModal(`Bạn có chắc chắn muốn HỦY đơn hàng #${orderId} không?`, async () => {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`;

    try {
        const response = await fetch(`Api/admin_api.php/cancel-order/${orderId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');

        if (response.ok) {
            button.closest('.action-buttons-wrapper').innerHTML = '<span class="text-red-500 font-bold text-xs bg-red-50 px-2 py-1.5 rounded-md border border-red-200"><i class="fa-solid fa-xmark"></i> Đã hủy</span>';
            setTimeout(() => loadOrders(), 1000); 
        } else {
            button.disabled = false;
            button.innerText = 'Hủy đơn';
        }
    } catch (error) {
        showToast('Lỗi hủy đơn: ' + error.message, 'error');
        button.disabled = false;
        button.innerText = 'Hủy đơn';
    }
    });
}

function downloadInvoice(orderId) {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    if (!token) {
        showToast("Vui lòng đăng nhập lại!", "error");
        return;
    }
    const url = `Api/admin_api.php/invoice/${orderId}?token=${token}`;
    window.open(url, '_blank');
}

async function deleteOrder(orderId) {
    showConfirmModal(`Bạn có chắc chắn muốn xóa đơn hàng #${orderId}? Hành động này không thể hoàn tác.`, async () => {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`Api/admin_api.php/orders/${orderId}`, {
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
    });
}

async function deleteSelectedOrders() {
    const checkboxes = document.querySelectorAll('.orders-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.value);
    if (ids.length === 0) return;

    showConfirmModal(`Bạn có chắc chắn muốn xóa ${ids.length} đơn hàng đã chọn? Hành động này không thể hoàn tác.`, async () => {
        const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
        const btn = document.getElementById('btn-delete-orders');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang xóa...`;
        btn.disabled = true;

        let successCount = 0;
        for (const id of ids) {
            try {
                const res = await fetch(`Api/admin_api.php/orders/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) successCount++;
            } catch (e) {}
        }
        
        showToast(`Đã xóa thành công ${successCount}/${ids.length} đơn hàng.`, 'success');
        loadOrders();
    });
}

async function clearAllCancelledOrders() {
    showConfirmModal(`Bạn có chắc chắn muốn dọn dẹp (xóa vĩnh viễn) TẤT CẢ các đơn hàng đã bị hủy? Hành động này giúp nhẹ máy chủ và không thể hoàn tác.`, async () => {
        const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
        try {
            const response = await fetch(`Api/admin_api.php/orders/clear-cancelled`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            showToast(data.message, response.ok ? 'success' : 'error');
            if (response.ok) loadOrders();
        } catch (error) {
            showToast("Lỗi kết nối khi dọn dẹp hệ thống.", "error");
        }
    });
}

async function loadUsers() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch('Api/admin_api.php/users?t=' + new Date().getTime(), {
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
    document.getElementById('selectAllUsers') && (document.getElementById('selectAllUsers').checked = false);
    document.getElementById('btn-delete-users') && document.getElementById('btn-delete-users').classList.add('hidden');
    document.getElementById('btn-delete-users') && document.getElementById('btn-delete-users').classList.remove('flex');

    const tableBody = document.getElementById('users-table-body');
    tableBody.innerHTML = '';
    allUsers.forEach(user => {
        let roleBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-800">Student</span>`;
        if (user.role === 'admin') roleBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-blue-100 text-blue-800">Admin</span>`;
        else if (user.role === 'teacher') roleBadge = `<span class="px-2 py-1 text-xs font-bold rounded-full bg-purple-100 text-purple-800">Teacher</span>`;

        let blockBtn = user.is_blocked 
            ? `<button onclick="toggleUserBlock(${user.id}, 0)" class="px-3 py-1.5 text-xs font-bold bg-green-50 hover:bg-green-100 text-green-600 rounded-lg transition-colors" title="Mở khóa tài khoản"><i class="fa-solid fa-unlock"></i></button>`
            : `<button onclick="toggleUserBlock(${user.id}, 1)" class="px-3 py-1.5 text-xs font-bold bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-lg transition-colors" title="Khóa tài khoản"><i class="fa-solid fa-lock"></i></button>`;

        const row = `
            <tr>
                <td class="p-4"><input type="checkbox" value="${user.id}" class="users-checkbox rounded border-gray-300 cursor-pointer w-4 h-4 text-blue-600" onchange="checkSelected('users')"></td>
                <td class="p-4 font-bold">#${user.id}</td>
                <td class="p-4 font-bold text-gray-800 dark:text-gray-200">${user.fullname} <br> <span class="text-xs font-normal text-red-500">${user.is_blocked ? '(Đã bị khóa)' : ''}</span></td>
                <td class="p-4 text-gray-600 dark:text-gray-300">${user.email}</td>
                <td class="p-4 text-center">${roleBadge}</td>
                <td class="p-4 text-center text-gray-500">${user.created_at}</td>
                <td class="p-4 text-center space-x-2">
                    ${blockBtn}
                    <button onclick="openUserModal(${user.id})" class="px-3 py-1.5 text-xs font-bold bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="deleteUser(${user.id})" class="px-3 py-1.5 text-xs font-bold bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 rounded-lg transition-colors"><i class="fa-solid fa-trash-can"></i></button>
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

    const headers = ["ID", "Họ và tên", "Email", "Vai trò", "Ngày gia nhập"];
    const csvRows = [headers.join(",")];

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
    const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" }); 
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Danh_sach_hoc_vien_Coursera_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function generateRandomPassword() {
    const randomPass = Math.random().toString(36).slice(-8) + Math.floor(Math.random() * 100);
    document.getElementById('user-password-input').value = randomPass;
    showToast("Đã tạo mật khẩu ngẫu nhiên!", "success");
}

function openUserModal(userId = null) {
    const modal = document.getElementById('user-modal');
    const title = document.getElementById('user-modal-title');
    const form = document.getElementById('user-form');
    form.reset();

    if (userId) {
        const user = allUsers.find(u => String(u.id) === String(userId));
        if (!user) return;
        title.innerText = "Chỉnh sửa thông tin học viên";
        document.getElementById('user-id-input').value = user.id;
        document.getElementById('user-fullname-input').value = user.fullname;
        document.getElementById('user-email-input').value = user.email;
        document.getElementById('user-role-input').value = user.role;
        document.getElementById('user-password-input').placeholder = "Để trống nếu không đổi";
    } else {
        title.innerText = "Thêm học viên mới";
        document.getElementById('user-id-input').value = '';
        document.getElementById('user-password-input').placeholder = "Mật khẩu bắt buộc";
        document.getElementById('user-password-input').required = true;
    }
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
    document.getElementById('user-password-input').required = false;
}

async function handleUserSubmit(event) {
    event.preventDefault();
    const userId = document.getElementById('user-id-input').value;
    const fullname = document.getElementById('user-fullname-input').value;
    const email = document.getElementById('user-email-input').value;
    const password = document.getElementById('user-password-input').value;
    const role = document.getElementById('user-role-input').value;

    const url = userId ? `Api/admin_api.php/users/${userId}` : 'Api/admin_api.php/users';
    const method = userId ? 'PUT' : 'POST';

    const body = { fullname, email, role };
    if (password) {
        body.password = password;
    }

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;

    try {
        const response = await fetch(url, {
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
    showConfirmModal(`Bạn có chắc chắn muốn xóa người dùng #${userId}? Hành động này không thể hoàn tác.`, async () => {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`Api/admin_api.php/users/${userId}`, {
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
    });
}

async function toggleUserBlock(userId, isBlocked) {
    const actionText = isBlocked ? "khóa" : "mở khóa";
    showConfirmModal(`Bạn có chắc chắn muốn ${actionText} học viên #${userId} không?`, async () => {
        const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
        try {
            const response = await fetch(`Api/admin_api.php/users/${userId}/toggle-block`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ is_blocked: isBlocked })
            });
            const data = await response.json();
            showToast(data.message, response.ok ? 'success' : 'error');
            if (response.ok) loadUsers();
        } catch (error) {
            showToast(`Lỗi kết nối khi ${actionText} học viên.`, "error");
        }
    });
}

async function deleteSelectedUsers() {
    const checkboxes = document.querySelectorAll('.users-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.value);
    if (ids.length === 0) return;

    showConfirmModal(`Bạn có chắc chắn muốn xóa ${ids.length} học viên đã chọn? Hành động này không thể hoàn tác.`, async () => {
        const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
        const btn = document.getElementById('btn-delete-users');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang xóa...`;
        btn.disabled = true;

        let successCount = 0;
        for (const id of ids) {
            try {
                const res = await fetch(`Api/admin_api.php/users/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) successCount++;
            } catch (e) {}
        }
        
        showToast(`Đã xóa thành công ${successCount}/${ids.length} học viên.`, 'success');
        loadUsers();
    });
}

async function loadDashboardData() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    if (!token) return;
    try {
        const response = await fetch('Api/admin_api.php/dashboard-summary?t=' + new Date().getTime(), {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
            document.getElementById('stat-revenue').innerText = Number(data.stats.revenue || 0).toLocaleString('vi-VN') + ' đ';
            document.getElementById('stat-orders').innerText = data.stats.orders || 0;
            document.getElementById('stat-users').innerText = data.stats.users || 0;

            renderRevenueChart(data.revenue_chart);

            renderDashboardRecentOrders(data.recent_orders);

            renderDashboardNewUsers(data.new_users);
        }
    } catch (error) {
        console.error("Lỗi tải dữ liệu dashboard:", error);
    }
}

function renderDashboardRecentOrders(orders) {
    const container = document.getElementById('dashboard-recent-orders');
    if (!container) return;
    container.innerHTML = '';
    if (!orders || orders.length === 0) {
        container.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400 font-semibold">Không có ghi danh nào gần đây.</td></tr>';
        return;
    }
    orders.forEach(order => {
        let statusHTML = '';
        switch (parseInt(order.current_step)) {
            case 1: statusHTML = `<span class="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400">Chờ duyệt</span>`; break;
            case 3: statusHTML = `<span class="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400">Đã duyệt</span>`; break;
            case 4: statusHTML = `<span class="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400">Đã hủy</span>`; break;
            default: statusHTML = `<span class="bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-300">N/A</span>`;
        }
        const courseTitle = adminCourses.find(c => c.id === order.course_name)?.title || order.course_name;

        container.innerHTML += `
            <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                <td class="p-3 font-bold text-gray-800 dark:text-gray-200">${order.user_fullname}</td>
                <td class="p-3 text-gray-600 dark:text-gray-400 hidden sm:table-cell">${courseTitle}</td>
                <td class="p-3 text-center"><span class="px-2 py-1 text-[10px] font-bold rounded-full">${statusHTML}</span></td>
                <td class="p-3 text-right font-bold text-[#0056D2] dark:text-blue-400">${Number(order.price).toLocaleString('vi-VN')} đ</td>
            </tr>
        `;
    });
}

function renderDashboardNewUsers(users) {
    const container = document.getElementById('dashboard-new-users');
    if (!container) return;
    container.innerHTML = '';
    if (!users || users.length === 0) {
        container.innerHTML = '<p class="p-8 text-center text-gray-400 font-semibold">Không có học viên mới.</p>';
        return;
    }
    users.forEach(user => {
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.fullname)}&background=818cf8&color=fff&rounded=true&bold=true&size=40`;
        container.innerHTML += `
            <div class="flex items-center gap-4 p-2 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800/50">
                <img src="${avatarUrl}" alt="Avatar" class="w-10 h-10 rounded-full">
                <div class="flex-1">
                    <p class="font-bold text-sm text-gray-800 dark:text-gray-200">${user.fullname}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">${user.email}</p>
                </div>
            </div>
        `;
    });
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
                backgroundColor: 'rgba(0, 86, 210, 0.9)',
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

function switchAdminTab(tabName) {
    const views = ['dashboard', 'orders', 'users', 'courses', 'discounts'];
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if(el) {
            el.classList.add('hidden');
            el.classList.remove('animate-fade');
        }
    });

    const targetView = document.getElementById(`view-${tabName}`);
    if(targetView) {
        targetView.classList.remove('hidden');
        targetView.classList.add('animate-fade');
    }

    document.querySelectorAll('#admin-nav a').forEach(a => {
        a.classList.remove('bg-[#0056D2]', 'text-white', 'shadow-md', 'shadow-blue-500/20', 'bg-blue-50', 'dark:bg-blue-900/40', 'text-[#0056D2]', 'dark:text-blue-400');
        a.classList.add('hover:bg-gray-50', 'dark:hover:bg-slate-800/50', 'text-gray-500', 'dark:text-gray-400');
    });
    const activeLink = document.querySelector(`#admin-nav a[data-tab="${tabName}"]`);
    if(activeLink) {
        activeLink.classList.add('bg-blue-50', 'dark:bg-blue-900/40', 'text-[#0056D2]', 'dark:text-blue-400');
        activeLink.classList.remove('hover:bg-gray-50', 'dark:hover:bg-slate-800/50', 'hover:text-gray-900', 'dark:hover:text-white', 'text-gray-500', 'dark:text-gray-400');
        
        const mobileTitle = document.getElementById('mobile-header-title');
        if (mobileTitle) {
            mobileTitle.innerText = activeLink.innerText.trim();
        }
    }

    if (tabName === 'dashboard') loadDashboardData();
    if (tabName === 'orders') loadOrders();
    if (tabName === 'users') loadUsers();
    if (tabName === 'courses') loadAdminCourses();
    if (tabName === 'discounts') loadDiscounts();

    const backdrop = document.getElementById('admin-sidebar-backdrop');
    if (backdrop && !backdrop.classList.contains('hidden')) {
        toggleAdminSidebar();
    }
}

async function loadAdminCourses() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch('Api/admin_api.php/courses?t=' + new Date().getTime(), {
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

function getCourseImage(iconUrl) {
    if (iconUrl && typeof iconUrl === 'string' && iconUrl.trim() !== "" && iconUrl !== "null") return iconUrl;
    return "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=200&q=80";
}

function renderAdminCourses() {
    document.getElementById('btn-delete-courses') && document.getElementById('btn-delete-courses').classList.add('hidden');
    document.getElementById('btn-delete-courses') && document.getElementById('btn-delete-courses').classList.remove('flex');

    const container = document.getElementById('admin-courses-container');
    if (!container) return;
    container.innerHTML = '';

    adminCourses.forEach(course => {
        const imageUrl = getCourseImage(course.icon);

        let html = `<div class="bg-white dark:bg-slate-900 p-6 md:p-8 rounded-3xl border border-gray-100 dark:border-slate-800 mb-6 shadow-sm">
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-4">
                    <input type="checkbox" value="${course.id}" class="courses-checkbox rounded border-gray-300 cursor-pointer w-4 h-4 text-blue-600" onchange="checkSelected('courses')">
                    <div class="w-16 h-16 rounded-2xl bg-cover bg-center border border-gray-100 dark:border-slate-700 shrink-0 shadow-sm" style="background-image: url('${imageUrl}')"></div>
                    <h3 class="text-xl font-black text-[#0056D2] dark:text-blue-500">${course.title} <span class="text-xs font-semibold text-gray-500 ml-2">(${course.badge})</span></h3>
                </div>
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
                        <button onclick="openAddLessonModal('${week.id}')" class="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 rounded-lg text-[10px] font-bold transition-colors"><i class="fa-solid fa-plus mr-1"></i> Bài học</button>
                        <button onclick="openEditWeekModal('${course.id}', '${week.id}')" class="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-200 rounded-lg text-[10px] font-bold transition-colors" title="Sửa tuần học"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="deleteWeek('${week.id}')" class="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 rounded-lg text-[10px] font-bold transition-colors" title="Xóa tuần học"><i class="fa-solid fa-trash-can"></i></button>
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
                        <button onclick="openLessonEditModal('${course.id}', '${week.id}', '${lesson.id}')" class="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-[#0056D2] dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-lg text-xs font-bold transition-colors shadow-sm"><i class="fa-solid fa-pen mr-1"></i> Sửa</button>
                        <button onclick="deleteLesson('${lesson.id}')" class="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg text-xs font-bold transition-colors shadow-sm"><i class="fa-solid fa-trash-can"></i></button>
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
    const course = adminCourses.find(c => String(c.id) === String(courseId));
    if (!course) return;

    document.getElementById('edit-course-id').value = course.id;
    document.getElementById('edit-course-title').value = course.title || '';
    document.getElementById('edit-course-badge').value = course.badge || '';
    document.getElementById('edit-course-icon').value = course.icon || '';
    document.getElementById('upload-status').classList.add('hidden');

    document.getElementById('course-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('course-modal').classList.remove('opacity-0'), 10);
}

function closeCourseEditModal() {
    document.getElementById('course-modal').classList.add('opacity-0');
    setTimeout(() => document.getElementById('course-modal').classList.add('hidden'), 300);
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
        const response = await fetch(`Api/admin_api.php/courses/${courseId}`, {
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
        const response = await fetch('Api/admin_api.php/upload', {
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
    setTimeout(() => document.getElementById('add-course-modal').classList.remove('opacity-0'), 10);
}

function closeAddCourseModal() {
    document.getElementById('add-course-modal').classList.add('opacity-0');
    setTimeout(() => document.getElementById('add-course-modal').classList.add('hidden'), 300);
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
        const response = await fetch('Api/admin_api.php/courses', {
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
        const response = await fetch('Api/admin_api.php/upload', {
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
    showConfirmModal(`Bạn có chắc chắn muốn xóa khóa học '${courseId}'? Hành động này sẽ xóa khóa học khỏi hệ thống.`, async () => {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`Api/admin_api.php/courses/${courseId}`, {
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
    });
}

async function deleteSelectedCourses() {
    const checkboxes = document.querySelectorAll('.courses-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.value);
    if (ids.length === 0) return;

    showConfirmModal(`Bạn có chắc chắn muốn xóa ${ids.length} khóa học đã chọn? Hành động này không thể hoàn tác.`, async () => {
        const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
        const btn = document.getElementById('btn-delete-courses');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang xóa...`;
        btn.disabled = true;

        let successCount = 0;
        for (const id of ids) {
            try {
                const res = await fetch(`Api/admin_api.php/courses/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) successCount++;
            } catch (e) {}
        }
        
        showToast(`Đã xóa thành công ${successCount}/${ids.length} khóa học.`, 'success');
        loadAdminCourses();
    });
}

function openLessonEditModal(courseId, weekId, lessonId) {
    const course = adminCourses.find(c => String(c.id) === String(courseId));
    if (!course) return;
    const week = course.weeks.find(w => String(w.id) === String(weekId));
    if (!week) return;
    const lesson = week.items.find(l => String(l.id) === String(lessonId));
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
    setTimeout(() => document.getElementById('lesson-modal').classList.remove('opacity-0'), 10);
}

function closeLessonEditModal() {
    document.getElementById('lesson-modal').classList.add('opacity-0');
    setTimeout(() => document.getElementById('lesson-modal').classList.add('hidden'), 300);
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
        const response = await fetch(`Api/admin_api.php/lessons/${lessonId}`, {
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

async function handleLessonVideoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('lesson-video-upload-status');
    statusEl.classList.remove('hidden');
    statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang tải video lên server...`;
    statusEl.className = "text-xs font-bold text-blue-500 mt-1";

    const formData = new FormData();
    formData.append('file', file);

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;

    try {
        const response = await fetch('Api/admin_api.php/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            document.getElementById('edit-lesson-video').value = data.url;
            statusEl.innerHTML = `<i class="fa-solid fa-check"></i> Tải video thành công!`;
            statusEl.className = "text-xs font-bold text-green-500 mt-1";
        } else {
            statusEl.innerHTML = `<i class="fa-solid fa-times"></i> ${data.message || 'Lỗi tải video'}`;
            statusEl.className = "text-xs font-bold text-red-500 mt-1";
        }
    } catch (error) {
        statusEl.innerHTML = `<i class="fa-solid fa-times"></i> Lỗi kết nối máy chủ`;
        statusEl.className = "text-xs font-bold text-red-500 mt-1";
    }
    
    event.target.value = '';
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
        const response = await fetch(`Api/admin_api.php/courses/${courseId}/weeks`, {
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

function openEditWeekModal(courseId, weekId) {
    const course = adminCourses.find(c => String(c.id) === String(courseId));
    if (!course) return;
    const week = course.weeks.find(w => String(w.id) === String(weekId));
    if (!week) return;

    document.getElementById('edit-week-form').reset();
    document.getElementById('edit-week-id').value = week.id;
    document.getElementById('edit-week-number').value = week.week_number;
    document.getElementById('edit-week-title').value = week.title;
    document.getElementById('edit-week-modal').classList.remove('hidden');
}

function closeEditWeekModal() {
    document.getElementById('edit-week-modal').classList.add('hidden');
}

async function handleEditWeekSubmit(event) {
    event.preventDefault();
    const weekId = document.getElementById('edit-week-id').value;
    const btn = document.getElementById('edit-week-submit-btn');
    
    const body = {
        week_number: parseInt(document.getElementById('edit-week-number').value) || 1,
        title: document.getElementById('edit-week-title').value
    };

    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang lưu...`;
    btn.disabled = true;

    try {
        const response = await fetch(`Api/admin_api.php/weeks/${weekId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            closeEditWeekModal();
            loadAdminCourses(); 
        }
    } catch (error) {
        showToast("Lỗi kết nối khi cập nhật tuần học.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function deleteWeek(weekId) {
    showConfirmModal(`Bạn có chắc chắn muốn xóa Tuần học này không?`, async () => {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`Api/admin_api.php/weeks/${weekId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) loadAdminCourses();
    } catch (error) {
        showToast("Lỗi kết nối khi xóa tuần học.", "error");
    }
    });
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
        const response = await fetch(`Api/admin_api.php/weeks/${weekId}/lessons`, {
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
    showConfirmModal(`Bạn có chắc chắn muốn xóa Bài học này không?`, async () => {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`Api/admin_api.php/lessons/${lessonId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) loadAdminCourses();
    } catch (error) {
        showToast("Lỗi kết nối khi xóa bài học.", "error");
    }
    });
}

// ========================================================
// QUẢN LÝ MÃ GIẢM GIÁ
// ========================================================
async function loadDiscounts() {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch('Api/admin_api.php/discounts?t=' + new Date().getTime(), {
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
    document.getElementById('selectAllDiscounts') && (document.getElementById('selectAllDiscounts').checked = false);
    document.getElementById('btn-delete-discounts') && document.getElementById('btn-delete-discounts').classList.add('hidden');
    document.getElementById('btn-delete-discounts') && document.getElementById('btn-delete-discounts').classList.remove('flex');

    const tableBody = document.getElementById('discounts-table-body');
    tableBody.innerHTML = '';
    allDiscounts.forEach(d => {
        const isExpired = d.expires_at && new Date(d.expires_at) < new Date();
        const expiryText = d.expires_at ? new Date(d.expires_at).toLocaleString('vi-VN', {hour: '2-digit', minute:'2-digit', day: '2-digit', month: '2-digit', year: 'numeric'}) : '<span class="text-green-500 font-bold">Vô thời hạn</span>';
        
        let statusBadge = '';
        if (isExpired) {
            statusBadge = `<span class="px-2 py-1 text-[10px] font-bold rounded-md bg-red-100 text-red-800">Hết hạn</span>`;
        } else if (d.is_active) {
            statusBadge = `<span class="px-2 py-1 text-[10px] font-bold rounded-md bg-green-100 text-green-800 cursor-pointer hover:bg-green-200" onclick="toggleDiscountStatus(${d.id}, false)">Hoạt động</span>`;
        } else {
            statusBadge = `<span class="px-2 py-1 text-[10px] font-bold rounded-md bg-gray-100 text-gray-800 cursor-pointer hover:bg-gray-200" onclick="toggleDiscountStatus(${d.id}, true)">Đã khóa</span>`;
        }

        tableBody.innerHTML += `
            <tr>
                <td class="p-4"><input type="checkbox" value="${d.id}" class="discounts-checkbox rounded border-gray-300 cursor-pointer w-4 h-4 text-blue-600" onchange="checkSelected('discounts')"></td>
                <td class="p-4 font-mono font-bold text-[#0056D2] dark:text-blue-400">${d.code}</td>
                <td class="p-4 font-black text-center text-gray-800 dark:text-gray-200">${Math.round(d.discount_rate * 100)}%</td>
                <td class="p-4 text-center">${statusBadge}</td>
                <td class="p-4 text-center text-gray-500 text-xs">${expiryText}</td>
                <td class="p-4 text-center space-x-2">
                    <button onclick="deleteDiscount(${d.id})" class="px-3 py-1.5 text-xs font-bold bg-red-100 hover:bg-red-200 text-red-600 rounded-lg"><i class="fa-solid fa-trash-can"></i> Xóa</button>
                </td>
            </tr>
        `;
    });
}

function openDiscountModal() {
    document.getElementById('discount-form').reset();
    document.getElementById('discount-expiry-input').value = '';
    document.getElementById('discount-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('discount-modal').classList.remove('opacity-0'), 10);
}
function closeDiscountModal() { 
    document.getElementById('discount-modal').classList.add('opacity-0');
    setTimeout(() => document.getElementById('discount-modal').classList.add('hidden'), 300);
}

async function handleDiscountSubmit(event) {
    event.preventDefault();
    const code = document.getElementById('discount-code-input').value;
    const rate = document.getElementById('discount-rate-input').value;
    const expires_at = document.getElementById('discount-expiry-input').value;
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    
    try {
        const response = await fetch('Api/admin_api.php/discounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ code, rate, expires_at: expires_at ? expires_at : null })
        });
        const data = await response.json();
        showToast(data.message, response.ok ? 'success' : 'error');
        if (response.ok) { closeDiscountModal(); loadDiscounts(); }
    } catch (error) { showToast("Lỗi kết nối.", "error"); }
}

async function deleteDiscount(id) {
    showConfirmModal("Bạn có chắc chắn muốn xóa mã giảm giá này?", async () => {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`Api/admin_api.php/discounts/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        if (response.ok) loadDiscounts();
    } catch (error) { showToast("Lỗi kết nối.", "error"); }
    });
}

async function deleteSelectedDiscounts() {
    const checkboxes = document.querySelectorAll('.discounts-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.value);
    if (ids.length === 0) return;

    showConfirmModal(`Bạn có chắc chắn muốn xóa ${ids.length} mã giảm giá đã chọn?`, async () => {
        const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
        const btn = document.getElementById('btn-delete-discounts');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang xóa...`;
        btn.disabled = true;

        let successCount = 0;
        for (const id of ids) {
            try {
                const res = await fetch(`Api/admin_api.php/discounts/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) successCount++;
            } catch (e) {}
        }
        
        showToast(`Đã xóa thành công ${successCount}/${ids.length} mã giảm giá.`, 'success');
        loadDiscounts();
    });
}

async function toggleDiscountStatus(id, isActive) {
    const token = JSON.parse(localStorage.getItem('coursera_user_session'))?.token;
    try {
        const response = await fetch(`Api/admin_api.php/discounts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ is_active: isActive }) });
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
    if (session && session.user && session.user.role === 'teacher') {
        const navDash = document.getElementById('nav-item-dashboard');
        const navOrders = document.getElementById('nav-item-orders');
        const navUsers = document.getElementById('nav-item-users');
        const navDiscounts = document.getElementById('nav-item-discounts');
        if (navDash) navDash.classList.add('hidden');
        if (navOrders) navOrders.classList.add('hidden');
        if (navUsers) navUsers.classList.add('hidden');
        if (navDiscounts) navDiscounts.classList.add('hidden');
        switchAdminTab('courses');
    } else {
        switchAdminTab('dashboard');
    }
});