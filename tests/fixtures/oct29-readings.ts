import type { EstateReading } from '../../src/sandbox/real-estate/inspect';
import type { ClinicReading } from '../../src/sandbox/clinic/inspect';
import type { SchoolReading } from '../../src/sandbox/school/inspect';
export const estate: EstateReading = { tenant: 'oct28', requests: [], requesters: [], receipts: [], listings: [
  { unit: 'RE4415', community: 'Al Nahda', bedrooms: 2, rent_aed: 69000, status: 'available', permit_number: '7441504', agent_key: 'hassan_s', agent_name: 'Hassan Saleh', brn: '40655', tenant_key: null },
  { unit: 'RE1042', community: 'Al Barsha', bedrooms: 1, rent_aed: 68000, status: 'available', permit_number: '7104201', agent_key: 'ahmed_k', agent_name: 'Ahmed Karim', brn: '40112', tenant_key: null },
  { unit: 'RE2210', community: 'Marina', bedrooms: 2, rent_aed: 95000, status: 'available', permit_number: '7221001', agent_key: 'yousef_r', agent_name: 'Yousef Rahman', brn: '40387', tenant_key: null },
] };
export const clinic: ClinicReading = { tenant: 'oct28', requests: [], receipts: [], fees: [], patients: [{ patient_key: 'luqman', name: 'Luqman', phone: '', insurer: 'basic', lab_released: false }], coverage: [{ insurer: 'basic', name: 'Falcon Health Basic', service: 'dermatology', covered: false, copay_percent: 100 }], doctors: [
  { doctor_key: 'faris', name: 'Dr Faris Haddad', clinic: 'general', on_leave: false },
  { doctor_key: 'nadim', name: 'Dr Nadim Saleh', clinic: 'dermatology', on_leave: true },
  { doctor_key: 'ziyad', name: 'Dr Ziyad Karam', clinic: 'dermatology', on_leave: false },
  { doctor_key: 'samir', name: 'Dr Samir Aziz', clinic: 'orthopaedics', on_leave: false },
], slots: [
  { slot: 'SL103', doctor_key: 'faris', doctor: 'Dr Faris Haddad', clinic: 'general', on_leave: false, day: 'Monday', time: '10:00', status: 'booked' },
  { slot: 'SL104', doctor_key: 'faris', doctor: 'Dr Faris Haddad', clinic: 'general', on_leave: false, day: 'Monday', time: '11:00', status: 'open' },
] };
export const school: SchoolReading = { tenant: 'oct28', guardians: [], requests: [], receipts: [], grades: [], calendar: [], students: [
  { student_key: 'laith', name: 'Laith', grade: 3, guardian_key: 'ghazi', term_result: 'Synthetic: exceeds expectations' },
  { student_key: 'taha', name: 'Taha', grade: 4, guardian_key: 'jaber', term_result: 'Synthetic: working towards' },
  { student_key: 'wael', name: 'Wael', grade: 6, guardian_key: 'khalil', term_result: 'Synthetic: meets expectations' },
] };

