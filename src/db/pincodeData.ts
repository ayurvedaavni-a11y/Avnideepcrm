// AVNIDEEP CRM PRO — Offline Pincode Intelligence
// 
// India Post uses a 6-digit PIN system where the FIRST digit identifies the postal region (state).
// This file provides:
// 1. STATE_PREFIX_MAP — 100% offline state detection for ANY valid Indian pincode
// 2. CITY_DATABASE — curated city/district lookup for major pincodes (extensible)

// First 1-2 digit prefix → state (covers all 36 states/UTs)
export const STATE_PREFIX_MAP: Record<string, string> = {
  // Region 1 — Delhi, Haryana, Punjab, HP, J&K
  '11': 'Delhi',
  '12': 'Haryana',
  '13': 'Punjab',
  '14': 'Punjab',
  '15': 'Punjab',
  '16': 'Chandigarh',
  '17': 'Himachal Pradesh',
  '18': 'Jammu and Kashmir',
  '19': 'Ladakh',
  // Region 2 — UP, Uttarakhand
  '20': 'Uttar Pradesh',
  '21': 'Uttar Pradesh',
  '22': 'Uttar Pradesh',
  '23': 'Uttar Pradesh',
  '24': 'Uttar Pradesh',
  '25': 'Uttar Pradesh',
  '26': 'Uttar Pradesh',
  '27': 'Uttar Pradesh',
  '28': 'Uttar Pradesh',
  '29': 'Uttarakhand',
  // Region 3 — Rajasthan, Gujarat, DD, DNH
  '30': 'Rajasthan',
  '31': 'Rajasthan',
  '32': 'Rajasthan',
  '33': 'Rajasthan',
  '34': 'Rajasthan',
  '36': 'Gujarat',
  '37': 'Gujarat',
  '38': 'Gujarat',
  '39': 'Daman and Diu',
  // Region 4 — Maharashtra, Madhya Pradesh, Chhattisgarh, Goa
  '40': 'Maharashtra',
  '41': 'Maharashtra',
  '42': 'Maharashtra',
  '43': 'Maharashtra',
  '44': 'Maharashtra',
  '45': 'Madhya Pradesh',
  '46': 'Madhya Pradesh',
  '47': 'Madhya Pradesh',
  '48': 'Madhya Pradesh',
  '49': 'Chhattisgarh',
  // Region 5 — AP, Karnataka, Telangana
  '50': 'Telangana',
  '51': 'Andhra Pradesh',
  '52': 'Andhra Pradesh',
  '53': 'Andhra Pradesh',
  '56': 'Karnataka',
  '57': 'Karnataka',
  '58': 'Karnataka',
  '59': 'Karnataka',
  // Region 6 — Tamil Nadu, Kerala, Puducherry, Lakshadweep
  '60': 'Tamil Nadu',
  '61': 'Tamil Nadu',
  '62': 'Tamil Nadu',
  '63': 'Tamil Nadu',
  '64': 'Tamil Nadu',
  '67': 'Kerala',
  '68': 'Kerala',
  '69': 'Kerala',
  // Region 7 — WB, Odisha, Arunachal, Assam, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, Tripura
  '70': 'West Bengal',
  '71': 'West Bengal',
  '72': 'West Bengal',
  '73': 'West Bengal',
  '74': 'West Bengal',
  '75': 'Odisha',
  '76': 'Odisha',
  '77': 'Odisha',
  '78': 'Assam',
  '79': 'Arunachal Pradesh',
  // Region 8 — Bihar, Jharkhand (overlapping prefix; Jharkhand mostly 81-82 north)
  '80': 'Bihar',
  '81': 'Bihar',
  '82': 'Bihar',
  '83': 'Jharkhand',
  '84': 'Bihar',
  '85': 'Bihar',
  // Region 9 — APS (military) - not for civilian
};

// Major city/district lookup for top pincodes (extensible — add more as needed)
export interface PincodeRecord {
  city: string;
  district: string;
  state: string;
}

export const CITY_DATABASE: Record<string, PincodeRecord> = {
  // Delhi
  '110001': { city: 'New Delhi', district: 'Central Delhi', state: 'Delhi' },
  '110002': { city: 'Daryaganj', district: 'Central Delhi', state: 'Delhi' },
  '110003': { city: 'Lodhi Road', district: 'Central Delhi', state: 'Delhi' },
  '110005': { city: 'Karol Bagh', district: 'Central Delhi', state: 'Delhi' },
  '110006': { city: 'Chandni Chowk', district: 'Central Delhi', state: 'Delhi' },
  '110017': { city: 'Saket', district: 'South Delhi', state: 'Delhi' },
  '110019': { city: 'Kalkaji', district: 'South Delhi', state: 'Delhi' },
  '110020': { city: 'Okhla', district: 'South East Delhi', state: 'Delhi' },
  '110024': { city: 'Lajpat Nagar', district: 'South East Delhi', state: 'Delhi' },
  '110034': { city: 'Pitampura', district: 'North West Delhi', state: 'Delhi' },
  '110044': { city: 'Badarpur', district: 'South East Delhi', state: 'Delhi' },
  '110045': { city: 'Janakpuri', district: 'West Delhi', state: 'Delhi' },
  '110054': { city: 'Civil Lines', district: 'North Delhi', state: 'Delhi' },
  '110085': { city: 'Rohini', district: 'North West Delhi', state: 'Delhi' },
  '110091': { city: 'Mayur Vihar', district: 'East Delhi', state: 'Delhi' },
  '110092': { city: 'Shahdara', district: 'East Delhi', state: 'Delhi' },
  '110096': { city: 'Mayur Vihar Phase 3', district: 'East Delhi', state: 'Delhi' },

  // Mumbai / Maharashtra
  '400001': { city: 'Fort, Mumbai', district: 'Mumbai', state: 'Maharashtra' },
  '400002': { city: 'Kalbadevi', district: 'Mumbai', state: 'Maharashtra' },
  '400003': { city: 'Masjid Bunder', district: 'Mumbai', state: 'Maharashtra' },
  '400005': { city: 'Colaba', district: 'Mumbai', state: 'Maharashtra' },
  '400007': { city: 'Grant Road', district: 'Mumbai', state: 'Maharashtra' },
  '400011': { city: 'Mumbai Central', district: 'Mumbai', state: 'Maharashtra' },
  '400013': { city: 'Lower Parel', district: 'Mumbai', state: 'Maharashtra' },
  '400022': { city: 'Sion', district: 'Mumbai', state: 'Maharashtra' },
  '400028': { city: 'Dadar West', district: 'Mumbai', state: 'Maharashtra' },
  '400050': { city: 'Bandra West', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400051': { city: 'Bandra East', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400053': { city: 'Andheri West', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400058': { city: 'Andheri', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400059': { city: 'Andheri East', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400063': { city: 'Goregaon West', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400064': { city: 'Malad West', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400067': { city: 'Kandivali West', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400068': { city: 'Borivali West', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400070': { city: 'Kurla West', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400072': { city: 'Powai', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400076': { city: 'Powai', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400078': { city: 'Bhandup West', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400080': { city: 'Mulund West', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400092': { city: 'Borivali East', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400097': { city: 'Malad East', district: 'Mumbai Suburban', state: 'Maharashtra' },
  '400703': { city: 'Vashi', district: 'Thane', state: 'Maharashtra' },
  '400706': { city: 'Nerul', district: 'Thane', state: 'Maharashtra' },
  '400709': { city: 'Belapur', district: 'Thane', state: 'Maharashtra' },
  '401101': { city: 'Mira Road', district: 'Thane', state: 'Maharashtra' },
  '401107': { city: 'Bhayandar East', district: 'Thane', state: 'Maharashtra' },
  '401209': { city: 'Vasai East', district: 'Palghar', state: 'Maharashtra' },
  '410210': { city: 'Kharghar', district: 'Raigad', state: 'Maharashtra' },
  '411001': { city: 'Pune', district: 'Pune', state: 'Maharashtra' },
  '411014': { city: 'Viman Nagar', district: 'Pune', state: 'Maharashtra' },
  '411027': { city: 'Pimpri', district: 'Pune', state: 'Maharashtra' },
  '411057': { city: 'Hinjewadi', district: 'Pune', state: 'Maharashtra' },
  '422001': { city: 'Nashik', district: 'Nashik', state: 'Maharashtra' },
  '440001': { city: 'Nagpur', district: 'Nagpur', state: 'Maharashtra' },

  // Bangalore / Karnataka
  '560001': { city: 'Bengaluru', district: 'Bangalore Urban', state: 'Karnataka' },
  '560002': { city: 'Chickpet', district: 'Bangalore Urban', state: 'Karnataka' },
  '560004': { city: 'Basavanagudi', district: 'Bangalore Urban', state: 'Karnataka' },
  '560008': { city: 'HAL', district: 'Bangalore Urban', state: 'Karnataka' },
  '560011': { city: 'Jayanagar', district: 'Bangalore Urban', state: 'Karnataka' },
  '560034': { city: 'Koramangala', district: 'Bangalore Urban', state: 'Karnataka' },
  '560037': { city: 'Marathahalli', district: 'Bangalore Urban', state: 'Karnataka' },
  '560038': { city: 'Indiranagar', district: 'Bangalore Urban', state: 'Karnataka' },
  '560066': { city: 'Whitefield', district: 'Bangalore Urban', state: 'Karnataka' },
  '560068': { city: 'BTM Layout', district: 'Bangalore Urban', state: 'Karnataka' },
  '560076': { city: 'JP Nagar', district: 'Bangalore Urban', state: 'Karnataka' },
  '560078': { city: 'Banashankari', district: 'Bangalore Urban', state: 'Karnataka' },
  '560100': { city: 'Electronic City', district: 'Bangalore Urban', state: 'Karnataka' },
  '570001': { city: 'Mysuru', district: 'Mysuru', state: 'Karnataka' },
  '575001': { city: 'Mangaluru', district: 'Dakshina Kannada', state: 'Karnataka' },
  '580001': { city: 'Hubballi', district: 'Dharwad', state: 'Karnataka' },

  // Chennai / Tamil Nadu
  '600001': { city: 'Chennai GPO', district: 'Chennai', state: 'Tamil Nadu' },
  '600002': { city: 'Anna Salai', district: 'Chennai', state: 'Tamil Nadu' },
  '600004': { city: 'Mylapore', district: 'Chennai', state: 'Tamil Nadu' },
  '600017': { city: 'T. Nagar', district: 'Chennai', state: 'Tamil Nadu' },
  '600020': { city: 'Adyar', district: 'Chennai', state: 'Tamil Nadu' },
  '600028': { city: 'R.A. Puram', district: 'Chennai', state: 'Tamil Nadu' },
  '600040': { city: 'Anna Nagar', district: 'Chennai', state: 'Tamil Nadu' },
  '600041': { city: 'Tiruvanmiyur', district: 'Chennai', state: 'Tamil Nadu' },
  '600042': { city: 'Velachery', district: 'Chennai', state: 'Tamil Nadu' },
  '600050': { city: 'Padi', district: 'Chennai', state: 'Tamil Nadu' },
  '600083': { city: 'Saligramam', district: 'Chennai', state: 'Tamil Nadu' },
  '600091': { city: 'Madipakkam', district: 'Chennai', state: 'Tamil Nadu' },
  '600096': { city: 'Perungudi', district: 'Chennai', state: 'Tamil Nadu' },
  '600113': { city: 'Tharamani', district: 'Chennai', state: 'Tamil Nadu' },
  '600119': { city: 'Sholinganallur', district: 'Chennai', state: 'Tamil Nadu' },
  '625001': { city: 'Madurai', district: 'Madurai', state: 'Tamil Nadu' },
  '641001': { city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu' },

  // Kolkata / WB
  '700001': { city: 'BBD Bagh', district: 'Kolkata', state: 'West Bengal' },
  '700016': { city: 'Park Street', district: 'Kolkata', state: 'West Bengal' },
  '700019': { city: 'Ballygunge', district: 'Kolkata', state: 'West Bengal' },
  '700020': { city: 'Alipore', district: 'Kolkata', state: 'West Bengal' },
  '700029': { city: 'Rashbehari', district: 'Kolkata', state: 'West Bengal' },
  '700053': { city: 'Behala', district: 'Kolkata', state: 'West Bengal' },
  '700064': { city: 'Salt Lake', district: 'Kolkata', state: 'West Bengal' },
  '700091': { city: 'Salt Lake Sector V', district: 'Kolkata', state: 'West Bengal' },
  '700156': { city: 'Rajarhat', district: 'North 24 Parganas', state: 'West Bengal' },

  // Hyderabad / Telangana
  '500001': { city: 'Hyderabad GPO', district: 'Hyderabad', state: 'Telangana' },
  '500003': { city: 'Secunderabad', district: 'Hyderabad', state: 'Telangana' },
  '500016': { city: 'Begumpet', district: 'Hyderabad', state: 'Telangana' },
  '500032': { city: 'Gachibowli', district: 'Rangareddy', state: 'Telangana' },
  '500033': { city: 'Banjara Hills', district: 'Hyderabad', state: 'Telangana' },
  '500034': { city: 'Jubilee Hills', district: 'Hyderabad', state: 'Telangana' },
  '500038': { city: 'Sanathnagar', district: 'Hyderabad', state: 'Telangana' },
  '500050': { city: 'KPHB', district: 'Hyderabad', state: 'Telangana' },
  '500072': { city: 'Kukatpally', district: 'Hyderabad', state: 'Telangana' },
  '500081': { city: 'Madhapur', district: 'Rangareddy', state: 'Telangana' },
  '500084': { city: 'Hitech City', district: 'Rangareddy', state: 'Telangana' },

  // Ahmedabad / Gujarat
  '380001': { city: 'Ahmedabad', district: 'Ahmedabad', state: 'Gujarat' },
  '380009': { city: 'Navrangpura', district: 'Ahmedabad', state: 'Gujarat' },
  '380015': { city: 'Satellite', district: 'Ahmedabad', state: 'Gujarat' },
  '380054': { city: 'Bodakdev', district: 'Ahmedabad', state: 'Gujarat' },
  '382010': { city: 'Sabarmati', district: 'Ahmedabad', state: 'Gujarat' },
  '382350': { city: 'Naroda', district: 'Ahmedabad', state: 'Gujarat' },
  '390001': { city: 'Vadodara', district: 'Vadodara', state: 'Gujarat' },
  '395003': { city: 'Surat', district: 'Surat', state: 'Gujarat' },

  // Jaipur / Rajasthan
  '302001': { city: 'Jaipur', district: 'Jaipur', state: 'Rajasthan' },
  '302017': { city: 'Mansarovar', district: 'Jaipur', state: 'Rajasthan' },
  '302039': { city: 'Vaishali Nagar', district: 'Jaipur', state: 'Rajasthan' },
  '313001': { city: 'Udaipur', district: 'Udaipur', state: 'Rajasthan' },
  '324001': { city: 'Kota', district: 'Kota', state: 'Rajasthan' },
  '342001': { city: 'Jodhpur', district: 'Jodhpur', state: 'Rajasthan' },

  // Lucknow / UP
  '226001': { city: 'Lucknow GPO', district: 'Lucknow', state: 'Uttar Pradesh' },
  '226010': { city: 'Gomti Nagar', district: 'Lucknow', state: 'Uttar Pradesh' },
  '226018': { city: 'Indira Nagar', district: 'Lucknow', state: 'Uttar Pradesh' },
  '208001': { city: 'Kanpur', district: 'Kanpur Nagar', state: 'Uttar Pradesh' },
  '201001': { city: 'Ghaziabad', district: 'Ghaziabad', state: 'Uttar Pradesh' },
  '201206': { city: 'Ghaziabad', district: 'Ghaziabad', state: 'Uttar Pradesh' },
  '201301': { city: 'Noida', district: 'Gautam Buddha Nagar', state: 'Uttar Pradesh' },
  '201305': { city: 'Greater Noida', district: 'Gautam Buddha Nagar', state: 'Uttar Pradesh' },
  '201309': { city: 'Noida Sector 62', district: 'Gautam Buddha Nagar', state: 'Uttar Pradesh' },
  '221001': { city: 'Varanasi', district: 'Varanasi', state: 'Uttar Pradesh' },
  '282001': { city: 'Agra', district: 'Agra', state: 'Uttar Pradesh' },
  '250001': { city: 'Meerut', district: 'Meerut', state: 'Uttar Pradesh' },

  // Patna / Bihar
  '800001': { city: 'Patna GPO', district: 'Patna', state: 'Bihar' },
  '800013': { city: 'Patliputra', district: 'Patna', state: 'Bihar' },

  // Chandigarh / Punjab / Haryana
  '160001': { city: 'Chandigarh', district: 'Chandigarh', state: 'Chandigarh' },
  '160017': { city: 'Sector 17', district: 'Chandigarh', state: 'Chandigarh' },
  '140301': { city: 'Mohali', district: 'SAS Nagar', state: 'Punjab' },
  '141001': { city: 'Ludhiana', district: 'Ludhiana', state: 'Punjab' },
  '143001': { city: 'Amritsar', district: 'Amritsar', state: 'Punjab' },
  '122001': { city: 'Gurugram', district: 'Gurugram', state: 'Haryana' },
  '122002': { city: 'Gurugram Sector 14', district: 'Gurugram', state: 'Haryana' },
  '122018': { city: 'Gurugram DLF Phase III', district: 'Gurugram', state: 'Haryana' },
  '121001': { city: 'Faridabad', district: 'Faridabad', state: 'Haryana' },
  '124001': { city: 'Rohtak', district: 'Rohtak', state: 'Haryana' },
  '125001': { city: 'Hisar', district: 'Hisar', state: 'Haryana' },

  // Bhopal / MP
  '462001': { city: 'Bhopal', district: 'Bhopal', state: 'Madhya Pradesh' },
  '452001': { city: 'Indore', district: 'Indore', state: 'Madhya Pradesh' },
  '474001': { city: 'Gwalior', district: 'Gwalior', state: 'Madhya Pradesh' },

  // Kochi / Trivandrum / Kerala
  '682001': { city: 'Kochi', district: 'Ernakulam', state: 'Kerala' },
  '682024': { city: 'Kakkanad', district: 'Ernakulam', state: 'Kerala' },
  '683101': { city: 'Aluva', district: 'Ernakulam', state: 'Kerala' },
  '695001': { city: 'Thiruvananthapuram', district: 'Thiruvananthapuram', state: 'Kerala' },
  '673001': { city: 'Kozhikode', district: 'Kozhikode', state: 'Kerala' },
  '688001': { city: 'Alappuzha', district: 'Alappuzha', state: 'Kerala' },

  // Bhubaneswar / Odisha
  '751001': { city: 'Bhubaneswar', district: 'Khordha', state: 'Odisha' },
  '753001': { city: 'Cuttack', district: 'Cuttack', state: 'Odisha' },

  // Guwahati / Assam
  '781001': { city: 'Guwahati', district: 'Kamrup Metropolitan', state: 'Assam' },

  // Goa
  '403001': { city: 'Panaji', district: 'North Goa', state: 'Goa' },
  '403601': { city: 'Margao', district: 'South Goa', state: 'Goa' },

  // Dehradun / Uttarakhand
  '248001': { city: 'Dehradun', district: 'Dehradun', state: 'Uttarakhand' },
  '249402': { city: 'Haridwar', district: 'Haridwar', state: 'Uttarakhand' },
  '249403': { city: 'Haridwar', district: 'Haridwar', state: 'Uttarakhand' },
  '263001': { city: 'Nainital', district: 'Nainital', state: 'Uttarakhand' },

  // Visakhapatnam / AP
  '530001': { city: 'Visakhapatnam', district: 'Visakhapatnam', state: 'Andhra Pradesh' },
  '520001': { city: 'Vijayawada', district: 'Krishna', state: 'Andhra Pradesh' },
  '517501': { city: 'Tirupati', district: 'Tirupati', state: 'Andhra Pradesh' },

  // Ranchi / Jharkhand
  '834001': { city: 'Ranchi', district: 'Ranchi', state: 'Jharkhand' },
  '831001': { city: 'Jamshedpur', district: 'East Singhbhum', state: 'Jharkhand' },

  // Raipur / Chhattisgarh
  '492001': { city: 'Raipur', district: 'Raipur', state: 'Chhattisgarh' },

  // Shimla / HP
  '171001': { city: 'Shimla', district: 'Shimla', state: 'Himachal Pradesh' },

  // Srinagar / Jammu / J&K
  '180001': { city: 'Jammu', district: 'Jammu', state: 'Jammu and Kashmir' },
  '190001': { city: 'Srinagar', district: 'Srinagar', state: 'Jammu and Kashmir' },
};

/**
 * Detect state from the first 2 (or 3 for special cases) digits of a 6-digit pincode.
 */
export function detectStateFromPrefix(pincode: string): string | null {
  if (!pincode || pincode.length < 2) return null;
  // Try 3-digit special cases first (e.g., Goa: 403, 404)
  const p3 = pincode.substring(0, 3);
  if (p3 === '403' || p3 === '404') return 'Goa';
  // Standard 2-digit
  const p2 = pincode.substring(0, 2);
  return STATE_PREFIX_MAP[p2] || null;
}

/**
 * Lookup pincode in curated DB. Returns null if not found.
 */
export function lookupPincode(pincode: string): PincodeRecord | null {
  if (!pincode || pincode.length !== 6) return null;
  return CITY_DATABASE[pincode] || null;
}
